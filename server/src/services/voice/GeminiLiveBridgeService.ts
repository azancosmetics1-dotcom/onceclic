import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config';
import { db } from '../../db';
import { VoiceService } from './VoiceService';
import { VoicePromptBuilder } from './VoicePromptBuilder';
import { SubscriptionStatus } from '@onceclic/shared';

export interface GeminiSessionTicketPayload {
  type: 'gemini_live_session';
  organizationId: string;
  callId: string;
  maxDurationSeconds: number;
  isGuest?: boolean;
  createdAt: number;
}

export function toGeminiSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return { type: 'STRING' };
  }
  const rawType = String(schema.type || 'STRING').toUpperCase();
  const result: any = {
    type: rawType,
    description: schema.description,
  };

  if (rawType === 'OBJECT' && schema.properties) {
    result.properties = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      result.properties[key] = toGeminiSchema(prop);
    }
    if (Array.isArray(schema.required)) {
      result.required = schema.required;
    }
  } else if (rawType === 'ARRAY' && schema.items) {
    result.items = toGeminiSchema(schema.items);
  }

  return result;
}

export function toGeminiFunctionDeclarations(tools: any[]): any[] {
  if (!Array.isArray(tools)) return [];
  return tools.map((t) => ({
    name: t.name,
    description: t.description || '',
    parameters: toGeminiSchema(t.parameters),
  }));
}

export class GeminiLiveBridgeService {
  private static wss: WebSocketServer | null = null;
  private static mockUpstreamHandler: ((clientWs: WebSocket, setup: any, callId: string, orgId: string) => void) | null = null;

  /**
   * For testing: set a custom mock upstream handler to simulate Gemini Live API responses
   */
  static setMockUpstreamHandler(handler: ((clientWs: WebSocket, setup: any, callId: string, orgId: string) => void) | null): void {
    this.mockUpstreamHandler = handler;
  }

  /**
   * Attach WebSocket server to an HTTP server
   */
  static init(server: HttpServer): WebSocketServer {
    const wss = new WebSocketServer({ noServer: true });
    this.wss = wss;

    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
      if (url.pathname === '/api/voice/live' || url.pathname === '/voice/live') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          this.handleClientConnection(ws, request);
        });
      }
    });

    return wss;
  }

  /**
   * Create a signed, short-lived session ticket for the browser
   */
  static async createSessionTicket(params: {
    organizationId: string;
    isGuest?: boolean;
    callerPhone?: string;
  }): Promise<{
    allowed: boolean;
    reason?: string;
    sessionTicket?: string;
    wsUrl?: string;
    callId?: string;
    remainingMinutes?: number;
    maxDurationSeconds?: number;
    maxConversationSeconds: number;
    appointmentReminderSeconds: number;
    provider: string;
  }> {
    const { organizationId, isGuest } = params;

    // 1. Subscription & Trial verification
    const sub = await db.getOne<{ status: string; trial_ends_at?: string }>(
      'SELECT status, trial_ends_at FROM subscriptions WHERE organization_id = $1',
      [organizationId]
    );

    if (
      sub?.status === SubscriptionStatus.EXPIRED ||
      (sub?.status === SubscriptionStatus.TRIALING && sub.trial_ends_at && new Date(sub.trial_ends_at) < new Date())
    ) {
      return {
        allowed: false,
        reason: 'Subscription or trial expired. Please renew or upgrade your subscription to use the AI voice receptionist.',
        maxConversationSeconds: 180,
        appointmentReminderSeconds: 120,
        provider: 'gemini_live',
      };
    }

    // 2. Usage verification
    const voiceUsage = await VoiceService.getVoiceUsage(organizationId);
    if (voiceUsage.limitReached || voiceUsage.remainingMinutes <= 0) {
      return {
        allowed: false,
        reason: voiceUsage.planTier === 'TRIAL'
          ? 'Free trial voice allowance (30 minutes) exhausted. Please upgrade to an ONCEClic paid plan.'
          : 'Monthly AI voice minute allowance exceeded. Please upgrade your plan.',
        remainingMinutes: 0,
        maxConversationSeconds: 180,
        appointmentReminderSeconds: 120,
        provider: 'gemini_live',
      };
    }

    // 3. Concurrency check (reserve in-flight minutes)
    let activeInFlightMinutes = 0;
    for (const active of VoiceService.activeCalls.values()) {
      if (active.organizationId === organizationId && !active.terminated) {
        const elapsedSec = Math.floor((Date.now() - active.startedAt) / 1000);
        activeInFlightMinutes += Math.max(1, Math.ceil(elapsedSec / 60));
      }
    }

    const availableMinutes = Math.max(0, voiceUsage.remainingMinutes - activeInFlightMinutes);
    if (availableMinutes <= 0) {
      return {
        allowed: false,
        reason: 'All available voice minutes are currently in use by an active session.',
        remainingMinutes: 0,
        maxConversationSeconds: 180,
        appointmentReminderSeconds: 120,
        provider: 'gemini_live',
      };
    }

    const callId = `gemini_live_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const maxDurationSeconds = Math.min(180, Math.max(1, Math.floor(availableMinutes * 60)));

    const payload: GeminiSessionTicketPayload = {
      type: 'gemini_live_session',
      organizationId,
      callId,
      maxDurationSeconds,
      isGuest: Boolean(isGuest),
      createdAt: Date.now(),
    };

    const sessionTicket = jwt.sign(payload, config.jwtSecret, { expiresIn: '5m' });
    const wsProtocol = config.app.apiUrl.startsWith('https') ? 'wss' : 'ws';
    const cleanHost = config.app.apiUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const wsUrl = `${wsProtocol}://${cleanHost}/api/voice/live`;

    return {
      allowed: true,
      sessionTicket,
      wsUrl,
      callId,
      remainingMinutes: voiceUsage.remainingMinutes,
      maxDurationSeconds,
      maxConversationSeconds: 180,
      appointmentReminderSeconds: 120,
      provider: 'gemini_live',
    };
  }

  /**
   * Handle incoming browser client WebSocket connection
   */
  static async handleClientConnection(clientWs: WebSocket, request: any): Promise<void> {
    const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
    const ticket = url.searchParams.get('ticket');

    if (!ticket) {
      clientWs.close(4401, 'Session ticket required');
      return;
    }

    let payload: GeminiSessionTicketPayload;
    try {
      payload = jwt.verify(ticket, config.jwtSecret) as GeminiSessionTicketPayload;
    } catch {
      clientWs.close(4401, 'Invalid or expired session ticket');
      return;
    }

    const { organizationId, callId, maxDurationSeconds } = payload;

    // Verify tenant still has valid allowance
    const voiceUsage = await VoiceService.getVoiceUsage(organizationId);
    if (voiceUsage.limitReached || voiceUsage.remainingMinutes <= 0) {
      clientWs.send(JSON.stringify({ type: 'error', error: 'Minute allowance exhausted' }));
      clientWs.close(4403, 'Minute allowance exhausted');
      return;
    }

    // Register active call for server-side duration limit & concurrency tracking
    const sessionStartedAt = Date.now();
    VoiceService.activeCalls.set(callId, {
      callId,
      organizationId,
      startedAt: sessionStartedAt,
      maxDurationSeconds: Math.min(180, maxDurationSeconds),
    });

    // Build speech-optimized prompt & tools
    let promptData: any;
    try {
      promptData = await VoicePromptBuilder.buildPrompt(organizationId);
    } catch (err: any) {
      VoiceService.activeCalls.delete(callId);
      clientWs.send(JSON.stringify({ type: 'error', error: 'Failed to build business voice prompt: ' + err.message }));
      clientWs.close(4500, 'Prompt construction failed');
      return;
    }

    const geminiTools = toGeminiFunctionDeclarations(promptData.tools);
    const liveModel = process.env.GEMINI_LIVE_MODEL || config.gemini?.liveModel || 'models/gemini-2.0-flash-exp';
    const liveVoice = process.env.GEMINI_LIVE_VOICE || config.gemini?.liveVoice || 'Aoede';

    const setupPayload: any = {
      model: liveModel,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: liveVoice,
            },
          },
        },
      },
      systemInstruction: {
        parts: [{ text: promptData.systemPrompt }],
      },
    };

    if (geminiTools.length > 0) {
      setupPayload.tools = [{ functionDeclarations: geminiTools }];
    }

    const setupMessage = {
      setup: setupPayload,
    };

    let sessionEnded = false;
    let appointmentReminderTimer: NodeJS.Timeout | null = null;
    let hardCeilingTimer: NodeJS.Timeout | null = null;
    let activeCallDurationSec = 0;
    const conversationTranscripts: string[] = [];

    const closeSession = async (reason: string = 'NORMAL_CLOSURE') => {
      if (sessionEnded) return;
      sessionEnded = true;

      if (appointmentReminderTimer) clearTimeout(appointmentReminderTimer);
      if (hardCeilingTimer) clearTimeout(hardCeilingTimer);

      const elapsedSec = Math.floor((Date.now() - sessionStartedAt) / 1000);
      activeCallDurationSec = Math.min(180, Math.max(0, elapsedSec));
      const durationMinutes = Math.round((activeCallDurationSec / 60) * 10) / 10;

      // Clean up in-flight tracker
      VoiceService.activeCalls.delete(callId);

      // Record completed call and consume allowance ONLY if actual audio duration occurred
      if (activeCallDurationSec > 0) {
        try {
          await VoiceService.handleCallEnded({
            callId,
            fromNumber: '+15550001111',
            toNumber: '',
            startedAt: new Date(sessionStartedAt).toISOString(),
            endedAt: new Date().toISOString(),
            durationSeconds: activeCallDurationSec,
            durationMinutes,
            transcript: conversationTranscripts.join('\n'),
            metadata: {
              organizationId,
              assistantId: `gemini_live_${organizationId}`,
              channel: 'WEB',
              reason,
            },
          });
        } catch (err: any) {
          console.warn('[GeminiLiveBridge] Error recording completed call record:', err?.message || err);
        }
      }

      try {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'ended', reason, durationSeconds: activeCallDurationSec }));
          clientWs.close();
        }
      } catch {}

      try {
        if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
          upstreamWs.close();
        }
      } catch {}
    };

    // Server-side Timers:
    // 120s: Polite appointment booking reminder
    appointmentReminderTimer = setTimeout(() => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            type: 'reminder',
            message: 'Would you like me to book an appointment for you before we finish?',
          })
        );
      }
    }, 120 * 1000);

    // 180s: Universal hard conversation limit
    hardCeilingTimer = setTimeout(() => {
      closeSession('MAX_DURATION_EXCEEDED');
    }, Math.min(180, maxDurationSeconds) * 1000);

    // Upstream Connection Handling: Mock/Simulated or Live Gemini API
    const isMockMode =
      Boolean(this.mockUpstreamHandler) ||
      process.env.USE_EMBEDDED_DB === 'true' ||
      config.voice.provider === 'mock' ||
      !config.gemini.apiKey ||
      config.gemini.apiKey.includes('placeholder');

    let upstreamWs: WebSocket | null = null;

    if (isMockMode) {
      // Notify client ready
      clientWs.send(
        JSON.stringify({
          type: 'ready',
          callId,
          maxDurationSeconds: Math.min(180, maxDurationSeconds),
          appointmentReminderSeconds: 120,
        })
      );

      if (this.mockUpstreamHandler) {
        this.mockUpstreamHandler(clientWs, setupMessage, callId, organizationId);
      }

      clientWs.on('message', async (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'end') {
            await closeSession('USER_ENDED');
          } else if (msg.type === 'audio') {
            // In mock mode, echo acknowledgment
            clientWs.send(JSON.stringify({ type: 'transcript', role: 'user', text: msg.transcript || '' }));
          }
        } catch {}
      });

      clientWs.on('close', () => {
        closeSession('CLIENT_DISCONNECT');
      });

      return;
    }

    // Connect to Google Gemini Multimodal Live API
    const upstreamUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(config.gemini.apiKey)}`;

    let sessionStage: 'INITIALIZING' | 'CONNECTING_GEMINI' | 'SETUP_SENT' | 'SETUP_COMPLETE' | 'ACTIVE' | 'CLOSING' = 'CONNECTING_GEMINI';
    let setupCompleteReceived = false;

    console.log(`[GeminiLiveBridge] [callId=${callId}] Connecting to Gemini Live API (model=${liveModel}, voice=${liveVoice}, org=${organizationId})`);

    try {
      upstreamWs = new WebSocket(upstreamUrl);
    } catch (err: any) {
      console.error(`[GeminiLiveBridge] [callId=${callId}] Failed to instantiate upstream WebSocket:`, err?.message || err);
      clientWs.send(JSON.stringify({ type: 'error', error: 'Could not connect to Google Gemini voice service' }));
      await closeSession('UPSTREAM_CONNECTION_FAILED');
      return;
    }

    upstreamWs.on('open', () => {
      sessionStage = 'SETUP_SENT';
      console.log(`[GeminiLiveBridge] [callId=${callId}] Upstream WebSocket connected. Sending initial setup payload (model=${liveModel}, voice=${liveVoice})...`);
      upstreamWs!.send(JSON.stringify(setupMessage));
    });

    upstreamWs.on('message', async (data: any) => {
      try {
        const msg = JSON.parse(data.toString());

        // Check for structured Gemini API errors
        if (msg.error) {
          console.error(`[GeminiLiveBridge] [callId=${callId}] Gemini API error (code=${msg.error.code}, status=${msg.error.status}):`, msg.error.message || 'Unknown error');
          const safeMessage = msg.error.message
            ? `Google Gemini error: ${msg.error.message}`
            : 'AI voice service returned an error';
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'error', error: safeMessage }));
          }
          return;
        }

        // Setup complete
        if (msg.setupComplete) {
          setupCompleteReceived = true;
          sessionStage = 'SETUP_COMPLETE';
          console.log(`[GeminiLiveBridge] [callId=${callId}] SetupComplete confirmed by Google Gemini Live API. Session ready.`);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(
              JSON.stringify({
                type: 'ready',
                callId,
                maxDurationSeconds: Math.min(180, maxDurationSeconds),
                appointmentReminderSeconds: 120,
              })
            );
          }
          sessionStage = 'ACTIVE';
          return;
        }

        // Server content (audio, transcript, interruption)
        if (msg.serverContent) {
          if (msg.serverContent.interrupted) {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: 'interrupted' }));
            }
          }

          if (msg.serverContent.turnComplete) {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: 'turn_complete' }));
            }
          }

          const parts = msg.serverContent.modelTurn?.parts || [];
          for (const part of parts) {
            if (part.inlineData?.data) {
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: 'audio', data: part.inlineData.data }));
              }
            }
            if (part.text) {
              conversationTranscripts.push(`AI: ${part.text}`);
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: 'transcript', role: 'assistant', text: part.text }));
              }
            }
          }
        }

        // Tool execution
        if (msg.toolCall?.functionCalls) {
          for (const call of msg.toolCall.functionCalls) {
            try {
              const result = await VoiceService.executeVoiceTool({
                callId,
                toolCallId: call.id,
                toolName: call.name,
                args: call.args || {},
                organizationId, // strictly enforce tenant isolation
              });

              if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
                upstreamWs.send(
                  JSON.stringify({
                    toolResponse: {
                      functionResponses: [
                        {
                          id: call.id,
                          name: call.name,
                          response: { result },
                        },
                      ],
                    },
                  })
                );
              }
            } catch (toolErr: any) {
              if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
                upstreamWs.send(
                  JSON.stringify({
                    toolResponse: {
                      functionResponses: [
                        {
                          id: call.id,
                          name: call.name,
                          response: { error: toolErr?.message || 'Tool execution failed' },
                        },
                      ],
                    },
                  })
                );
              }
            }
          }
        }
      } catch (parseErr: any) {
        console.warn(`[GeminiLiveBridge] [callId=${callId}] Failed parsing upstream message:`, parseErr?.message);
      }
    });

    upstreamWs.on('error', (err: any) => {
      console.error(`[GeminiLiveBridge] [callId=${callId}] Upstream WebSocket error (stage=${sessionStage}):`, err?.message || err);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'error',
          error: 'Voice service connection error with Google Gemini',
        }));
      }
      closeSession('UPSTREAM_ERROR');
    });

    upstreamWs.on('close', (code: number, reasonBuffer: Buffer) => {
      const reasonStr = reasonBuffer ? reasonBuffer.toString('utf8') : '';
      console.error(
        `[GeminiLiveBridge] [callId=${callId}] Upstream Gemini WebSocket closed. Code: ${code}, Reason: "${reasonStr}", Stage: ${sessionStage}, SetupComplete: ${setupCompleteReceived}`
      );

      let clientErrorMessage = 'AI voice session ended';
      if (!setupCompleteReceived) {
        if (code === 1008) {
          clientErrorMessage = reasonStr.includes('API key')
            ? 'Gemini Live authentication failed: API key invalid. Please verify GEMINI_API_KEY on Railway.'
            : `Gemini Live authentication rejected (Code: 1008): ${reasonStr || 'Policy violation'}`;
        } else if (code === 1007 || code === 1003) {
          clientErrorMessage = `Gemini Live payload rejected (Code: ${code}): ${reasonStr || 'Invalid setup configuration'}`;
        } else {
          clientErrorMessage = reasonStr
            ? `Gemini Live connection closed before setup complete: ${reasonStr} (Code: ${code})`
            : `Gemini Live connection closed before setup complete (Code: ${code})`;
        }
      } else if (reasonStr) {
        clientErrorMessage = `Gemini Live session ended: ${reasonStr}`;
      }

      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'error',
          error: clientErrorMessage,
        }));
      }

      closeSession(clientErrorMessage);
    });

    // Client messages (audio from browser microphone)
    clientWs.on('message', (data: any) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'audio' && msg.data) {
          if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
            upstreamWs.send(
              JSON.stringify({
                realtimeInput: {
                  mediaChunks: [
                    {
                      mimeType: 'audio/pcm;rate=16000',
                      data: msg.data,
                    },
                  ],
                },
              })
            );
          }
        } else if (msg.type === 'end') {
          closeSession('USER_HANGUP');
        }
      } catch {}
    });

    clientWs.on('error', () => {
      closeSession('CLIENT_ERROR');
    });

    clientWs.on('close', () => {
      closeSession('CLIENT_CLOSED');
    });
  }
}
