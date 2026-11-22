/**
 * Deepgram Voice Agent Client for Browser
 * Connects directly to Deepgram Voice Agent API (wss://agent.deepgram.com/v1/agent/converse)
 * Powered by Deepgram Voice Agent (STT, Managed Production LLM: GPT-4o-mini, TTS & Real-Time Audio).
 * (Google Gemini is retained strictly for ONCEClic text intelligence and knowledge embeddings).
 *
 * Audio specs:
 * - Microphone input: 16,000 Hz, 16-bit PCM mono (streamed binary after SettingsApplied)
 * - Speaker output: 24,000 Hz, 16-bit PCM mono
 * - Interruption handling: UserStartedSpeaking event stops playback instantly (barge-in)
 * - Session ceiling: 180-second hard stop enforced locally and on backend
 * - Appointment reminder: 120-second prompt
 * - Function calling: Dispatches FunctionCallRequest to ONCEClic backend tool proxy and returns FunctionCallResponse
 */

import { VoiceSessionStatus, BrowserVoiceCallbacks } from './vapiBrowserVoice';

export type VoiceResponseState =
  | 'IDLE'                     // Initial state / waiting for speech
  | 'CUSTOMER_TURNING'         // Customer speech detected / customer turn active
  | 'ASSISTANT_SPEAKING'       // Assistant speaking the single authorized response
  | 'TOOL_PENDING'             // Tool requested and executing; preliminary audio suppressed
  | 'TOOL_AWAITING_AGENT'      // Tool executed, FunctionCallResponse sent; awaiting agent response; audio strictly suppressed
  | 'RESPONSE_COMPLETED'       // Single response completed; further assistant speech locked
  | 'TERMINATED';              // Call ended / resources cleaned up

export type FinalizationState = 'IDLE' | 'PENDING' | 'SUCCEEDED' | 'FAILED';

export interface DeepgramVoiceClientOptions {
  deepgramToken: string;
  deepgramWsUrl?: string;
  sttWsUrl?: string;
  voiceTurnUrl?: string;
  pipeline?: string;
  sessionTicket: string;
  settings?: any;
  toolEndpointUrl?: string;
  sessionEndUrl?: string;
  maxDurationSeconds?: number;
  appointmentReminderSeconds?: number;
  callbacks?: BrowserVoiceCallbacks;
}

export interface DeepgramDiagnostics {
  microphonePermissionGranted: boolean;
  webSocketConnected: boolean;
  welcomeReceived: boolean;
  settingsApplied: boolean;
  audioFramesSent: number;
  audioChunksReceived: number;
  audioBytesDecoded: number;
  audioPlaybackStarted: boolean;
  functionCallsExecuted: number;
  interruptionsDetected: number;
  lastError?: string;
}

export class DeepgramVoiceClient {
  private deepgramToken: string;
  private wsUrl: string;
  private sttWsUrl: string;
  private voiceTurnUrl: string;
  private pipeline: string;
  private sessionTicket: string;
  private settings: any;
  private toolEndpointUrl: string;
  private sessionEndUrl: string;
  private maxDurationSeconds: number;
  private appointmentReminderSeconds: number;
  private callbacks: BrowserVoiceCallbacks;

  // Modular Voice state
  private activeResponseId: string | null = null;
  private isInterrupted: boolean = false;
  private lastSubmittedTranscript: string = '';

  private ws: WebSocket | null = null;
  private status: VoiceSessionStatus = 'idle';

  // Audio pipeline
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private recordProcessor: ScriptProcessorNode | null = null;
  private recordSource: MediaStreamAudioSourceNode | null = null;
  private muteGain: GainNode | null = null;
  private isReadyToSendAudio: boolean = false;

  // Audio playback queue
  private nextPlayTime: number = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  // Sequence ID for the current agent response turn.
  // Incremented every time AgentStartedSpeaking fires for a NEW assistant turn.
  // Audio chunks store the sequence ID at the time they were queued;
  // any chunk with a stale ID is silently discarded to prevent cross-response overlap.
  private currentResponseSeq: number = 0;

  // Diagnostics
  private diagnostics: DeepgramDiagnostics = {
    microphonePermissionGranted: false,
    webSocketConnected: false,
    welcomeReceived: false,
    settingsApplied: false,
    audioFramesSent: 0,
    audioChunksReceived: 0,
    audioBytesDecoded: 0,
    audioPlaybackStarted: false,
    functionCallsExecuted: 0,
    interruptionsDetected: 0,
  };

  // Timers
  private timerInterval: any = null;
  private callStartTimestamp: number | null = null;
  private reminderTriggered: boolean = false;
  private conversationTranscripts: Array<{ role: 'user' | 'assistant'; text: string }> = [];

  // Turn management & deduplication
  private currentTurnId: string | null = null;
  private currentTurnRole: 'user' | 'assistant' | null = null;
  private currentTurnText: string = '';
  private turnSequence: number = 0;
  private lastEmittedRole: string = '';
  private lastEmittedText: string = '';
  private lastEmittedTime: number = 0;
  private pendingCallEnd: boolean = false;
  // Terminal call-end flag: set when end_call fires; blocks all new turn creation
  private isCallEnded: boolean = false;
  // Track whether we have scheduled the goodbye drain (so it only happens once)
  private goodbyeAudioDraining: boolean = false;
  // Track whether a tool call is currently in-flight (used to detect follow-up assistant turns)
  private toolCallInFlight: boolean = false;

  // Deterministic Response State Machine & Idempotent Cleanup
  private responseState: VoiceResponseState = 'IDLE';
  private pendingToolCallId: string | null = null;
  private authorizedToolCallId: string | null = null;
  private suppressAudio: boolean = false;
  private cleanedUp: boolean = false;
  private holdDrainTimer: any = null;

  // Backend session finalization state machine & bounded retries
  private finalizationState: FinalizationState = 'IDLE';
  private finalizationPromise: Promise<boolean> | null = null;
  private finalizationError: string | null = null;
  private finalizationAttempts: number = 0;
  private readonly MAX_FINALIZATION_RETRIES: number = 2;

  public getResponseState(): VoiceResponseState {
    return this.responseState;
  }

  public getStatus(): VoiceSessionStatus {
    return this.status;
  }

  public getSuppressAudio(): boolean {
    return this.suppressAudio;
  }

  public getCurrentResponseSeq(): number {
    return this.currentResponseSeq;
  }

  public getFinalizationState(): FinalizationState {
    return this.finalizationState;
  }

  public getFinalizationError(): string | null {
    return this.finalizationError;
  }

  public getFinalizationAttempts(): number {
    return this.finalizationAttempts;
  }

  public getActiveResponseId(): string | null {
    return this.activeResponseId;
  }

  public setActiveResponseId(id: string | null): void {
    this.activeResponseId = id;
  }

  public getPipeline(): string {
    return this.pipeline;
  }

  public getIsInterrupted(): boolean {
    return this.isInterrupted;
  }

  constructor(options: DeepgramVoiceClientOptions) {
    this.deepgramToken = options.deepgramToken;
    this.sttWsUrl =
      options.sttWsUrl ||
      'wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&model=nova-2&smart_format=true&endpointing=300';
    this.pipeline = options.pipeline || 'modular_stt_server_tts';
    this.wsUrl = options.sttWsUrl || options.deepgramWsUrl || this.sttWsUrl;
    this.sessionTicket = options.sessionTicket;
    this.settings = options.settings;
    this.toolEndpointUrl = options.toolEndpointUrl || '/api/voice/tools/execute';
    this.sessionEndUrl = options.sessionEndUrl || '/api/voice/session/end';
    this.voiceTurnUrl =
      options.voiceTurnUrl ||
      options.toolEndpointUrl?.replace(/\/tools\/execute$/, '/voice/turn') ||
      '/api/public/org/default/voice/turn';
    this.maxDurationSeconds = options.maxDurationSeconds || 180;
    this.appointmentReminderSeconds = options.appointmentReminderSeconds || 120;
    this.callbacks = options.callbacks || {};
  }

  private setStatus(status: VoiceSessionStatus, error?: string) {
    this.status = status;
    if (error) {
      this.diagnostics.lastError = error;
    }
    this.callbacks.onStatusChange?.(status, error);
  }

  public getDiagnostics(): DeepgramDiagnostics {
    return { ...this.diagnostics };
  }

  private startTimer(): void {
    this.clearTimer();
    this.callStartTimestamp = Date.now();
    this.reminderTriggered = false;

    this.timerInterval = setInterval(() => {
      if (!this.callStartTimestamp) return;
      const elapsedSeconds = Math.floor((Date.now() - this.callStartTimestamp) / 1000);
      const remainingSeconds = Math.max(0, this.maxDurationSeconds - elapsedSeconds);

      this.callbacks.onTimerTick?.(elapsedSeconds, remainingSeconds);

      // 120s appointment booking reminder
      if (
        !this.reminderTriggered &&
        elapsedSeconds >= this.appointmentReminderSeconds &&
        elapsedSeconds < this.maxDurationSeconds
      ) {
        this.reminderTriggered = true;
        this.callbacks.onAppointmentReminder?.();
      }

      // 180s hard limit enforcement
      if (elapsedSeconds >= this.maxDurationSeconds) {
        this.stop('MAX_DURATION_EXCEEDED');
      }
    }, 1000);
  }

  private clearTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  /**
   * Start microphone capture and connect to Deepgram Voice Agent WebSocket.
   * AudioContext is created and resumed synchronously inside this call (user gesture).
   */
  public async start(): Promise<void> {
    try {
      this.setStatus('requesting_microphone');

      // 1. Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.mediaStream = stream;
      this.diagnostics.microphonePermissionGranted = true;

      // 2. Initialize unified AudioContext on user gesture
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioCtx();
      this.audioContext = audioContext;

      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // 3. Connect to Deepgram Voice Agent WebSocket
      this.setStatus('connecting');
      await this.connectWebSocket();

      // 4. Set up microphone capture pipeline (buffer until SettingsApplied)
      this.setupMicrophonePipeline(stream, audioContext);
    } catch (err: any) {
      console.error('[DeepgramVoiceClient] Failed to start voice session:', err);
      let errorMsg = 'Could not access microphone. Please grant permission.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMsg = 'Microphone permission was denied. Please allow microphone access in your browser settings.';
      } else if (err.message) {
        errorMsg = err.message;
      }
      this.setStatus('error', errorMsg);
      this.cleanup();
    }
  }

  /**
   * Connect to Deepgram Voice Agent WebSocket using token-based authentication (subprotocol).
   */
  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Deepgram token authentication in browsers:
        // Temporary JWT tokens minted via /v1/auth/grant use the 'bearer' subprotocol
        // wss://agent.deepgram.com/v1/agent/converse with subprotocol ['bearer', deepgramToken]
        const isJwt = this.deepgramToken?.startsWith('eyJ');
        const tokenPrefix = isJwt ? 'bearer' : 'token';
        const protocols = this.deepgramToken ? [tokenPrefix, this.deepgramToken] : [];
        const ws = new WebSocket(this.wsUrl, protocols);
        this.ws = ws;
        ws.binaryType = 'arraybuffer';

        let connectionSettled = false;

        ws.onopen = () => {
          this.diagnostics.webSocketConnected = true;
          // For modular STT listen endpoints, mark ready immediately
          if (this.wsUrl.includes('listen')) {
            this.diagnostics.settingsApplied = true;
            this.isReadyToSendAudio = true;
            this.setStatus('listening');
            this.startTimer();
            if (!connectionSettled) {
              connectionSettled = true;
              resolve();
            }
          }
        };

        ws.onmessage = async (event: MessageEvent) => {
          // Binary audio data from Deepgram
          if (event.data instanceof ArrayBuffer || ArrayBuffer.isView(event.data)) {
            const bytes = event.data instanceof Uint8Array
              ? event.data
              : ArrayBuffer.isView(event.data)
                ? new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength)
                : new Uint8Array(event.data);
            this.handleIncomingAudio(bytes);
            return;
          }

          if (typeof event.data === 'string') {
            try {
              const msg = JSON.parse(event.data);
              await this.handleServerEvent(msg);
              if (!connectionSettled && (msg.type === 'Welcome' || msg.type === 'SettingsApplied')) {
                connectionSettled = true;
                resolve();
              }
            } catch (parseErr) {
              console.warn('[DeepgramVoiceClient] Failed to parse server message:', parseErr);
            }
          }
        };

        ws.onerror = (err: any) => {
          console.error('[DeepgramVoiceClient] WebSocket error:', err);
          if (!connectionSettled) {
            connectionSettled = true;
            reject(new Error('Failed to connect to Deepgram Voice Agent service.'));
          }
          // Immediate terminal local cleanup: stop mic tracks, audio context, audio sources, clear timers
          this.cleanup();
          if (this.status !== 'ended') {
            this.setStatus('error', 'Voice connection error');
          }
          // Attempt backend finalization with session ticket
          this.finalizeSession('WS_ERROR').catch((fErr) => {
            console.warn('[DeepgramVoiceClient] Finalization after WS error failed:', fErr);
          });
        };

        ws.onclose = (event: any) => {
          console.log(`[DeepgramVoiceClient] WebSocket closed (code: ${event.code}, reason: "${event.reason || 'none'}")`);
          // Immediate terminal local cleanup
          this.cleanup();
          if (this.status !== 'ended') {
            if (event.code === 1008 || event.code === 4401) {
              this.setStatus('error', 'Voice authentication token expired or invalid.');
            } else {
              this.setStatus('ended');
            }
          }
          // Attempt backend finalization with session ticket
          this.finalizeSession('WS_CLOSED').catch((fErr) => {
            console.warn('[DeepgramVoiceClient] Finalization after WS close failed:', fErr);
          });
        };

        // 10s connection timeout
        setTimeout(() => {
          if (!connectionSettled) {
            connectionSettled = true;
            reject(new Error('Connection to Deepgram Voice Agent timed out.'));
          }
        }, 10000);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Handle Deepgram Voice Agent & STT JSON events
   */
  private async handleServerEvent(msg: any): Promise<void> {
    const eventType = msg.type;

    // ── Deepgram Nova-2 / STT (listen) Events ──
    if (eventType === 'SpeechStarted' || msg.speech_started === true) {
      this.handleBargeIn('STT_SPEECH_STARTED');
      return;
    }

    if (eventType === 'Results' || msg.channel?.alternatives) {
      const alt = msg.channel?.alternatives?.[0];
      const transcript = alt?.transcript?.trim();
      const isSpeechFinal = Boolean(msg.speech_final || msg.is_final);

      if (transcript) {
        if (!isSpeechFinal) {
          // Interim customer transcript for UI display
          this.callbacks.onTranscript?.('user', transcript, 'interim_turn');
        } else {
          // Final customer turn: deduplicate against immediate last transcript
          if (transcript !== this.lastSubmittedTranscript) {
            this.lastSubmittedTranscript = transcript;
            await this.submitFinalTranscript(transcript);
          }
        }
      }
      return;
    }

    switch (eventType) {
      case 'Welcome':
        this.diagnostics.welcomeReceived = true;
        // Step 2: Send Settings message immediately upon Welcome
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          const settingsPayload = this.settings || { type: 'Settings' };
          this.ws.send(JSON.stringify(settingsPayload));
        }
        break;

      case 'SettingsApplied':
        this.diagnostics.settingsApplied = true;
        this.isReadyToSendAudio = true;
        this.setStatus('listening');
        this.startTimer();
        break;

      case 'UserStartedSpeaking':
        // Interruption / Barge-in: ignore if call is already ended or terminated
        if (this.isCallEnded || this.responseState === 'TERMINATED') break;
        this.diagnostics.interruptionsDetected++;

        // PART 5.5: Immediately halt current playback and reset timeline
        this.interruptPlayback();
        this.setStatus('listening');

        // Fresh customer turn unlocks response lock and clears any pending tool authorization
        this.responseState = 'CUSTOMER_TURNING';
        this.pendingToolCallId = null;
        this.authorizedToolCallId = null;
        this.suppressAudio = false;

        if (this.currentTurnRole !== 'user') {
          this.turnSequence++;
          this.currentTurnRole = 'user';
          this.currentTurnId = `turn_user_${this.turnSequence}_${Date.now()}`;
          this.currentTurnText = '';
        }
        break;

      case 'AgentStartedSpeaking':
        if (this.responseState === 'TERMINATED') {
          break;
        }
        if (this.isCallEnded && !this.pendingCallEnd) {
          break;
        }

        // PART 5.4: Prevent unsolicited second responses.
        // If the single authorized assistant response for this customer turn has completed,
        // suppress any unsolicited additional AgentStartedSpeaking.
        if (this.responseState === 'RESPONSE_COMPLETED') {
          console.log('[DeepgramVoiceClient] Suppressing unsolicited second assistant response in completed turn');
          this.suppressAudio = true;
          break;
        }

        // PART 5.3: If a tool is currently pending execution, suppress preliminary audio
        if (this.responseState === 'TOOL_PENDING') {
          console.log('[DeepgramVoiceClient] Suppressing preliminary speech before tool execution');
          this.suppressAudio = true;
          break;
        }

        // Legitimate final tool-result response:
        // Strictly authorized ONLY when in TOOL_AWAITING_AGENT and authorizedToolCallId is present
        if (this.responseState === 'TOOL_AWAITING_AGENT' && this.authorizedToolCallId) {
          console.log(`[DeepgramVoiceClient] Legitimate final tool-result response authorized to speak for tool ${this.authorizedToolCallId}`);
          this.responseState = 'ASSISTANT_SPEAKING';
          this.suppressAudio = false;
          this.authorizedToolCallId = null;
          this.toolCallInFlight = false;
          this.currentTurnRole = 'assistant';
          this.setStatus('speaking');
          this.flushAudioQueue();
          break;
        }

        if (this.responseState === 'TOOL_AWAITING_AGENT') {
          console.warn('[DeepgramVoiceClient] Unexpected AgentStartedSpeaking in TOOL_AWAITING_AGENT without authorization');
          this.suppressAudio = true;
          break;
        }

        // Ordinary assistant response for customer turn:
        this.responseState = 'ASSISTANT_SPEAKING';
        this.suppressAudio = false;
        this.setStatus('speaking');

        if (this.currentTurnRole !== 'assistant') {
          this.turnSequence++;
          this.currentTurnRole = 'assistant';
          this.currentTurnId = `turn_assistant_${this.turnSequence}_${Date.now()}`;
          this.currentTurnText = '';

          // -----------------------------------------------------------------------
          // AUDIO OVERLAP FIX: Every new assistant response must start on a clean
          // audio timeline.
          // -----------------------------------------------------------------------
          this.flushAudioQueue();
        }
        break;

      case 'AgentThinking':
        // Deepgram think model is generating response
        break;

      case 'AgentAudioDone':
        // If a tool is executing or awaiting result, pre-tool speech is finishing on Deepgram side.
        // Do NOT transition to RESPONSE_COMPLETED — tool response has not even started yet!
        if (this.responseState === 'TOOL_PENDING' || this.responseState === 'TOOL_AWAITING_AGENT') {
          break;
        }

        // Per Deepgram docs: AgentAudioDone fires ONCE per complete agent response (not per chunk).
        if (this.pendingCallEnd && !this.goodbyeAudioDraining) {
          this.goodbyeAudioDraining = true;
          const audioCtx = this.audioContext;
          let drainMs = 500; // safe minimum
          if (audioCtx) {
            const remaining = this.nextPlayTime - audioCtx.currentTime;
            drainMs = Math.min(8000, Math.max(500, Math.ceil(remaining * 1000) + 400));
          }
          if (this.holdDrainTimer) clearTimeout(this.holdDrainTimer);
          this.holdDrainTimer = setTimeout(() => {
            this.stop('NORMAL_END');
          }, drainMs);
          return;
        }

        // PART 5.1 & 5.4: Assistant completed its one allowed spoken response for this turn.
        if (this.responseState === 'ASSISTANT_SPEAKING') {
          this.responseState = 'RESPONSE_COMPLETED';
          this.suppressAudio = true;
          this.toolCallInFlight = false;

          // Wait for queued audio buffers to drain on the WebAudio clock before returning to listening
          const audioCtx = this.audioContext;
          let drainMs = 300;
          if (audioCtx) {
            const remaining = Math.max(0, this.nextPlayTime - audioCtx.currentTime);
            drainMs = Math.ceil(remaining * 1000) + 150;
          }

          if (this.holdDrainTimer) clearTimeout(this.holdDrainTimer);
          this.holdDrainTimer = setTimeout(() => {
            if (
              this.responseState === 'RESPONSE_COMPLETED' &&
              !this.isCallEnded &&
              !this.pendingCallEnd
            ) {
              this.setStatus('listening');
            }
          }, drainMs);
        }
        break;

      case 'ConversationText':
        if (msg.role && msg.content) {
          // Drop all events once call has ended or terminated
          if (this.isCallEnded || this.responseState === 'TERMINATED') break;

          const role: 'user' | 'assistant' = msg.role === 'user' ? 'user' : 'assistant';
          const rawText = typeof msg.content === 'string' ? msg.content.trim() : '';
          if (!rawText) break;

          // PART 6: Discard preliminary assistant text or unsolicited second assistant text
          if (role === 'assistant') {
            if (
              this.responseState === 'TOOL_PENDING' ||
              this.responseState === 'TOOL_AWAITING_AGENT' ||
              this.responseState === 'RESPONSE_COMPLETED'
            ) {
              break;
            }
          }

          let isNewTurn = false;
          if (this.currentTurnRole !== role || !this.currentTurnId) {
            this.turnSequence++;
            this.currentTurnRole = role;
            this.currentTurnId = `turn_${role}_${this.turnSequence}_${Date.now()}`;
            this.currentTurnText = '';
            isNewTurn = true;
          }

          // Exact duplicate within current turn -> ignore
          if (rawText === this.currentTurnText) {
            break;
          }

          // Shorter partial arriving out-of-order -> ignore
          if (
            this.currentTurnText &&
            this.currentTurnText.startsWith(rawText) &&
            this.currentTurnText.length > rawText.length + 3
          ) {
            break;
          }

          // Duplicate message repeated rapidly across turns -> ignore
          const now = Date.now();
          if (
            this.lastEmittedRole === role &&
            this.lastEmittedText.toLowerCase() === rawText.toLowerCase() &&
            now - this.lastEmittedTime < 4000
          ) {
            break;
          }

          // Tool-call follow-up merge:
          if (isNewTurn && role === 'assistant' && this.toolCallInFlight) {
            this.toolCallInFlight = false; // consume the flag
            const lastAssistantIndex = this.conversationTranscripts.length - 1;
            if (
              lastAssistantIndex >= 0 &&
              this.conversationTranscripts[lastAssistantIndex].role === 'assistant'
            ) {
              const prevTurnId = this.currentTurnId;
              this.currentTurnText = rawText;
              this.lastEmittedRole = role;
              this.lastEmittedText = rawText;
              this.lastEmittedTime = now;
              this.conversationTranscripts[lastAssistantIndex].text = rawText;
              this.callbacks.onTranscript?.(role, rawText, prevTurnId, false);
              break;
            }
          } else if (role === 'assistant') {
            this.toolCallInFlight = false;
          }

          this.currentTurnText = rawText;
          this.lastEmittedRole = role;
          this.lastEmittedText = rawText;
          this.lastEmittedTime = now;

          if (isNewTurn || this.conversationTranscripts.length === 0) {
            this.conversationTranscripts.push({ role, text: rawText });
          } else {
            const last = this.conversationTranscripts[this.conversationTranscripts.length - 1];
            if (last && last.role === role) {
              last.text = rawText;
            } else {
              this.conversationTranscripts.push({ role, text: rawText });
            }
          }

          this.callbacks.onTranscript?.(role, rawText, this.currentTurnId, isNewTurn);
        }
        break;

      case 'FunctionCallRequest':
        // PART 5.3: Preliminary audio suppression
        // When tool request arrives, activate preliminary audio suppression.
        // Immediately stop and discard any preliminary speech audio.
        this.interruptPlayback();
        this.responseState = 'TOOL_PENDING';
        this.suppressAudio = true;
        this.toolCallInFlight = true;
        await this.handleFunctionCallRequest(msg);
        break;

      case 'Error':
        console.error('[DeepgramVoiceClient] Deepgram returned error:', msg.description || msg.message || msg);
        this.setStatus('error', msg.description || msg.message || 'Voice agent error');
        break;

      case 'Warning':
        console.warn('[DeepgramVoiceClient] Deepgram warning:', msg.description || msg);
        break;

      default:
        break;
    }
  }

  /**
   * Handle client-side function calling requested by Deepgram.
   * Dispatches the call to ONCEClic backend proxy, then returns FunctionCallResponse.
   */
  private async handleFunctionCallRequest(msg: any): Promise<void> {
    const functions = msg.functions || (msg.function_name ? [{ id: msg.function_call_id, name: msg.function_name, arguments: msg.input, client_side: true }] : []);

    for (const fn of functions) {
      const toolCallId = fn.id || `fn_${Date.now()}`;
      const toolName = fn.name;
      let args = {};
      try {
        args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : (fn.arguments || {});
      } catch {
        args = {};
      }

      this.diagnostics.functionCallsExecuted++;

      try {
        const response = await fetch(this.toolEndpointUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionTicket: this.sessionTicket,
            toolName,
            args,
            toolCallId,
          }),
        });

        const data = await response.json();
        const toolResult = data.result !== undefined ? data.result : data;

        if (toolResult?.callEnded || toolName === 'end_call') {
          // Mark call as ended immediately — stop microphone, block new turns
          this.isCallEnded = true;
          this.pendingCallEnd = true;
          // Stop mic immediately so no further user audio is streamed
          this.isReadyToSendAudio = false;
          if (this.mediaStream) {
            this.mediaStream.getTracks().forEach((track) => track.stop());
          }
        }

        // Send FunctionCallResponse back to Deepgram
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              type: 'FunctionCallResponse',
              id: toolCallId,
              name: toolName,
              content: JSON.stringify(toolResult),
            })
          );
        }

        // Transition to TOOL_AWAITING_AGENT with authorized toolCallId.
        // KEEP suppressAudio = true! Do NOT enable audio yet!
        // Audio is only authorized when Deepgram emits AgentStartedSpeaking for the tool result.
        if (this.responseState !== 'TERMINATED') {
          this.responseState = 'TOOL_AWAITING_AGENT';
          this.authorizedToolCallId = toolCallId;
          this.pendingToolCallId = null;
          this.suppressAudio = true;
        }
      } catch (err: any) {
        console.error(`[DeepgramVoiceClient] Failed executing tool ${toolName}:`, err);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              type: 'FunctionCallResponse',
              id: toolCallId,
              name: toolName,
              content: JSON.stringify({ error: err?.message || 'Tool execution failed' }),
            })
          );
        }
        if (this.responseState !== 'TERMINATED') {
          this.responseState = 'TOOL_AWAITING_AGENT';
          this.authorizedToolCallId = toolCallId;
          this.pendingToolCallId = null;
          this.suppressAudio = true;
        }
      }
    }
  }

  /**
   * Set up audio input recording pipeline downsampled to 16kHz linear16 PCM.
   */
  private setupMicrophonePipeline(stream: MediaStream, audioContext: AudioContext): void {
    const recordSource = audioContext.createMediaStreamSource(stream);
    this.recordSource = recordSource;

    const bufferSize = 2048;
    const recordProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);
    this.recordProcessor = recordProcessor;

    // Connect through 0-gain mute node to keep processor active without speaker feedback
    const muteGain = audioContext.createGain();
    muteGain.gain.value = 0;
    this.muteGain = muteGain;

    recordProcessor.onaudioprocess = (e) => {
      if (!this.isReadyToSendAudio || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }

      const inputFloat32 = e.inputBuffer.getChannelData(0);
      const hardwareSampleRate = audioContext.sampleRate;

      // Downsample float32 to 16kHz PCM16
      const pcm16Buffer = this.downsampleTo16kPCM(inputFloat32, hardwareSampleRate);
      if (pcm16Buffer && pcm16Buffer.byteLength > 0) {
        this.diagnostics.audioFramesSent++;
        // Deepgram accepts raw binary PCM audio frames over WebSocket
        this.ws.send(pcm16Buffer);

        // Report volume level
        let sum = 0;
        for (let i = 0; i < inputFloat32.length; i++) {
          sum += inputFloat32[i] * inputFloat32[i];
        }
        const rms = Math.sqrt(sum / inputFloat32.length);
        this.callbacks.onVolumeLevel?.(Math.min(1, rms * 5));
      }
    };

    recordSource.connect(recordProcessor);
    recordProcessor.connect(muteGain);
    muteGain.connect(audioContext.destination);
  }

  /**
   * Downsamples arbitrary audio sample rate to 16,000 Hz 16-bit signed integer PCM.
   */
  private downsampleTo16kPCM(input: Float32Array, inputSampleRate: number): ArrayBuffer {
    const targetSampleRate = 16000;
    if (inputSampleRate === targetSampleRate) {
      const output = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return output.buffer;
    }

    const sampleRateRatio = inputSampleRate / targetSampleRate;
    const outputLength = Math.round(input.length / sampleRateRatio);
    const output = new Int16Array(outputLength);

    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < outputLength) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      let accum = 0;
      let count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < input.length; i++) {
        accum += input[i];
        count++;
      }
      const avg = count > 0 ? accum / count : 0;
      const s = Math.max(-1, Math.min(1, avg));
      output[offsetResult] = s < 0 ? s * 0x8000 : s * 0x7fff;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }

    return output.buffer;
  }

  /**
   * Decodes and queues 24kHz linear16 PCM speaker output audio from Deepgram.
   * Each chunk is tagged with the currentResponseSeq and responseId so stale chunks from a
   * previous response that arrive late are silently discarded BEFORE they are
   * ever scheduled on the WebAudio clock.
   */
  public handleIncomingAudio(rawBytes: Uint8Array | ArrayBuffer, chunkResponseId?: string): void {
    const bytes = rawBytes instanceof ArrayBuffer ? new Uint8Array(rawBytes) : rawBytes;
    if (!this.audioContext || bytes.byteLength < 2) return;

    // Reject audio if customer interrupted (barge-in) or session terminated
    if (this.isInterrupted || this.responseState === 'TERMINATED') {
      return;
    }

    // Response ID check: reject any chunk tagged with a superseded or mismatched response ID
    if (chunkResponseId && chunkResponseId !== this.activeResponseId) {
      return;
    }

    // PART 1: Discard any audio that is not explicitly in ASSISTANT_SPEAKING with suppressAudio = false.
    // Rejects preliminary audio, delayed pre-tool frames (TOOL_PENDING & TOOL_AWAITING_AGENT),
    // unsolicited audio (RESPONSE_COMPLETED), customer speech (CUSTOMER_TURNING),
    // and terminated audio (TERMINATED) before decode!
    if (this.responseState !== 'ASSISTANT_SPEAKING' || this.suppressAudio) {
      return;
    }

    // ── GUARD (pre-schedule) ─────────────────────────────────────────────────
    // Capture the response sequence ID RIGHT NOW, before any decode work.
    // If flushAudioQueue() fires between here and source.start() the guard
    // below will catch it and discard the chunk before it touches the WebAudio
    // scheduler.  This is the only correct placement — checking AFTER start()
    // is too late because the source is already enqueued on the audio clock.
    const mySeq = this.currentResponseSeq;

    this.diagnostics.audioChunksReceived++;
    this.diagnostics.audioBytesDecoded += bytes.byteLength;

    // Convert raw PCM16 bytes to Float32 samples (synchronous — no async gap)
    const pcm16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768.0;
    }

    const sampleRate = 24000;
    const audioBuffer = this.audioContext.createBuffer(1, float32.length, sampleRate);
    audioBuffer.getChannelData(0).set(float32);

    // ── GUARD (pre-start) ────────────────────────────────────────────────────
    // Re-check seq and responseState after PCM decode. Checking here guarantees
    // we never call source.start() for a superseded or suppressed response.
    if (
      mySeq !== this.currentResponseSeq ||
      this.responseState !== 'ASSISTANT_SPEAKING' ||
      this.suppressAudio
    ) {
      return;
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    const currentTime = this.audioContext.currentTime;
    const startTime = Math.max(currentTime, this.nextPlayTime);
    source.start(startTime);
    this.nextPlayTime = startTime + audioBuffer.duration;

    this.activeSources.push(source);
    this.diagnostics.audioPlaybackStarted = true;

    source.onended = () => {
      const idx = this.activeSources.indexOf(source);
      if (idx !== -1) {
        this.activeSources.splice(idx, 1);
      }
    };
  }

  /**
   * Flush the current audio queue for a new agent response turn.
   * Called when AgentStartedSpeaking fires for a NEW assistant turn
   * (guarded by currentTurnRole !== 'assistant' in the event handler).
   *
   * ── Core invariant ───────────────────────────────────────────────────────
   * nextPlayTime encodes "the WebAudio clock time when the last scheduled
   * audio buffer ends."  Every new chunk schedules at:
   *
   *   startTime = Math.max(audioContext.currentTime, nextPlayTime)
   *
   * Therefore: as long as nextPlayTime is never moved BACKWARD while active
   * sources are still scheduled AHEAD of it, two AudioBufferSourceNodes
   * can never play simultaneously.  This function enforces that invariant.
   *
   * ── Two cases ────────────────────────────────────────────────────────────
   *
   * Case A — R1 tail > FLUSH_THRESHOLD_SEC (> 300 ms remaining):
   *   The previous response is mid-sentence.  Stop all active R1 sources
   *   immediately (they are superseded) AND reset nextPlayTime = currentTime.
   *   R2's first chunk will schedule at currentTime — no gap, no overlap.
   *
   * Case B — R1 tail ≤ FLUSH_THRESHOLD_SEC (≤ 300 ms remaining, or finished):
   *   The previous response is at its end.  Preserve the R1 sources so the
   *   final syllable is not truncated, AND preserve nextPlayTime unchanged.
   *   R2's first chunk will schedule at Math.max(currentTime, nextPlayTime)
   *   which is ≥ nextPlayTime ≥ R1's end — strictly AFTER R1 finishes.
   *   No simultaneous playback is possible regardless of how quickly R2's
   *   chunks arrive from the network.
   *
   * ── Why NOT resetting nextPlayTime in Case B is the fix ──────────────────
   *   The previous version reset nextPlayTime = currentTime in both cases.
   *   In Case B this was a bug: R1 sources were still playing through
   *   currentTime + remaining, but R2 could schedule at currentTime —
   *   placing R2's startTime inside R1's still-playing window.
   *
   * ── seq increment is always unconditional ────────────────────────────────
   *   currentResponseSeq++ runs in both cases.  Any late-arriving R1 binary
   *   frames from the WebSocket are discarded by the pre-start guard in
   *   handleIncomingAudio() before they ever call source.start().  This
   *   prevents network-delayed R1 chunks from extending the R1 tail beyond
   *   the nextPlayTime that was current at flush time.
   *
   * ── Distinct from interruptPlayback() (barge-in) ─────────────────────────
   *   User barge-in must cancel R1 immediately with no threshold.
   *   interruptPlayback() stops all sources and resets nextPlayTime
   *   unconditionally, regardless of remaining time.
   *
   * FLUSH_THRESHOLD_SEC = 0.3 s (truncation policy, not network timing):
   *   Controls whether we truncate R1's tail.  Overlap prevention does NOT
   *   depend on this value — it is guaranteed by the nextPlayTime invariant.
   */
  private readonly FLUSH_THRESHOLD_SEC = 0.3;

  private flushAudioQueue(): void {
    // Always advance seq — primary guard against late-arriving R1 binary frames.
    this.currentResponseSeq++;

    const audioCtx = this.audioContext;
    if (!audioCtx) return;

    const remaining = this.nextPlayTime - audioCtx.currentTime;

    if (remaining > this.FLUSH_THRESHOLD_SEC) {
      // ── Case A: Significant audio still queued — stop R1 immediately ──
      // R1 is superseded mid-sentence.  Stop all active sources and reset
      // nextPlayTime so R2 schedules at currentTime (plays right now).
      const sourcesToStop = [...this.activeSources];
      this.activeSources = [];
      for (const source of sourcesToStop) {
        try {
          source.stop();
          source.disconnect();
        } catch {}
      }
      // Safe to reset: no active sources remain to play into this window.
      this.nextPlayTime = audioCtx.currentTime;
    }
    // ── Case B: Tail ≤ threshold — preserve R1 sources and nextPlayTime ──
    // Do NOT reset nextPlayTime.  R2 chunks schedule at
    // Math.max(currentTime, nextPlayTime) which is ≥ R1's end.
    // The timeline is serialised — no simultaneous playback possible.
  }

  /**
   * Instantly halt audio output when user interrupts (barge-in).
   * Also advances currentResponseSeq so any in-flight audio chunks
   * arriving for the interrupted response are discarded.
   */
  private interruptPlayback(): void {
    // Advance sequence so late-arriving chunks from the interrupted response are dropped
    this.currentResponseSeq++;

    const sourcesToStop = [...this.activeSources];
    this.activeSources = [];
    for (const source of sourcesToStop) {
      try {
        source.stop();
        source.disconnect();
      } catch {}
    }
    if (this.audioContext) {
      this.nextPlayTime = this.audioContext.currentTime;
    }
  }

  /**
   * Customer interruption / Barge-in:
   * Instantly stops all playing audio, invalidates active response ID,
   * clears queue, and returns state to CUSTOMER_TURNING / listening.
   */
  public handleBargeIn(reason: string = 'USER_BARGE_IN'): void {
    if (this.isCallEnded || this.responseState === 'TERMINATED') return;
    this.diagnostics.interruptionsDetected++;
    this.isInterrupted = true;
    this.activeResponseId = null;
    this.suppressAudio = true;
    this.interruptPlayback();
    this.responseState = 'CUSTOMER_TURNING';
    this.setStatus('listening');
    this.currentTurnRole = 'user';
  }

  /**
   * Submit finalized customer transcript to ONCEClic server turn endpoint.
   * Server executes Knowledge Base search, silent tools, and returns Aura TTS audio.
   */
  public async submitFinalTranscript(transcript: string): Promise<any> {
    const cleanText = transcript.trim();
    if (!cleanText || this.isCallEnded || this.responseState === 'TERMINATED') {
      return null;
    }

    this.turnSequence++;
    const turnId = `turn_user_${this.turnSequence}_${Date.now()}`;
    this.callbacks.onTranscript?.('user', cleanText, turnId);

    this.isInterrupted = false;
    this.responseState = 'CUSTOMER_TURNING';
    this.setStatus('connecting');

    try {
      const fetchImpl = typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : global.fetch;
      const res = await fetchImpl(this.voiceTurnUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionTicket: this.sessionTicket,
          userTranscript: cleanText,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Voice turn request failed: HTTP ${res.status} ${errBody}`);
      }

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Voice turn failed on server');
      }

      // Interruption guard during network latency:
      // If customer interrupted while the server was working, drop response immediately!
      if (this.isInterrupted || (this.responseState as VoiceResponseState) === 'TERMINATED') {
        console.log('[DeepgramVoiceClient] Customer interrupted during server turn; dropping stale response');
        return data;
      }

      const { responseId, assistantText, audioBase64, sampleRate, callEnded } = data;

      // Authorize this specific responseId
      this.activeResponseId = responseId;
      this.currentResponseSeq++;
      this.responseState = 'ASSISTANT_SPEAKING';
      this.suppressAudio = false;
      this.setStatus('speaking');

      if (assistantText) {
        this.callbacks.onTranscript?.('assistant', assistantText, responseId);
      }

      if (audioBase64) {
        this.playTurnAudio(responseId, audioBase64, sampleRate || 24000, callEnded);
      }

      return data;
    } catch (err: any) {
      console.error('[DeepgramVoiceClient] Error processing voice turn:', err);
      this.setStatus('listening');
      return null;
    }
  }

  /**
   * Schedule and play audio chunks for the approved responseId.
   * Guarantees:
   * - Sequential, non-overlapping playback via WebAudio clock.
   * - Rejection of stale, mismatched, or interrupted audio.
   * - Bounded buffer scheduling.
   */
  public playTurnAudio(
    responseId: string,
    audioBase64OrBytes: string | Uint8Array | ArrayBuffer,
    sampleRate: number = 24000,
    callEnded: boolean = false
  ): void {
    if (!responseId || responseId !== this.activeResponseId || this.isInterrupted || (this.responseState as VoiceResponseState) === 'TERMINATED') {
      return;
    }

    if (!this.audioContext) return;

    let pcmBytes: Uint8Array;
    if (typeof audioBase64OrBytes === 'string') {
      const binaryString = atob(audioBase64OrBytes);
      pcmBytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        pcmBytes[i] = binaryString.charCodeAt(i);
      }
    } else if (audioBase64OrBytes instanceof ArrayBuffer) {
      pcmBytes = new Uint8Array(audioBase64OrBytes);
    } else {
      pcmBytes = audioBase64OrBytes;
    }

    if (pcmBytes.byteLength < 2) return;

    const numSamples = Math.floor(pcmBytes.byteLength / 2);
    const pcm16 = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, numSamples);
    const float32 = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      float32[i] = pcm16[i] / 32768.0;
    }

    const safeSampleRate = (sampleRate >= 16000 && sampleRate <= 48000) ? sampleRate : 24000;
    const audioBuffer = this.audioContext.createBuffer(1, float32.length, safeSampleRate);
    audioBuffer.getChannelData(0).set(float32);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    const currentTime = this.audioContext.currentTime;
    const startTime = Math.max(currentTime, this.nextPlayTime);
    source.start(startTime);
    this.nextPlayTime = startTime + audioBuffer.duration;
    this.activeSources.push(source);
    this.diagnostics.audioPlaybackStarted = true;

    source.onended = () => {
      const idx = this.activeSources.indexOf(source);
      if (idx !== -1) {
        this.activeSources.splice(idx, 1);
      }
      if (this.activeSources.length === 0) {
        this.responseState = 'RESPONSE_COMPLETED';
        if (callEnded) {
          // Goodbye: clean session termination after playing complete goodbye audio
          this.stop('NORMAL_END').catch(() => {});
        } else if (this.status === 'speaking') {
          this.setStatus('listening');
        }
      }
    };
  }

  /**
   * Finalizes the voice session with the ONCEClic backend idempotently.
   * - Sets state to PENDING while request is in flight.
   * - Shares in-flight request if called concurrently.
   * - Only sets state to SUCCEEDED after HTTP 2xx response.
   * - If request fails or times out, state becomes FAILED and remains retryable.
   * - Preserves backend provider_call_id idempotency to prevent duplicate billing.
   */
  public async finalizeSession(reason: string = 'USER_ENDED'): Promise<boolean> {
    if (this.finalizationState === 'SUCCEEDED') {
      return true;
    }
    if (this.finalizationState === 'PENDING' && this.finalizationPromise) {
      return this.finalizationPromise;
    }

    const elapsedSeconds = this.callStartTimestamp
      ? Math.floor((Date.now() - this.callStartTimestamp) / 1000)
      : 0;

    if (!this.sessionTicket || elapsedSeconds <= 0) {
      this.finalizationState = 'SUCCEEDED';
      return true;
    }

    this.finalizationState = 'PENDING';
    this.finalizationPromise = (async () => {
      let attempt = 0;
      const maxAttempts = 1 + this.MAX_FINALIZATION_RETRIES;

      while (attempt < maxAttempts) {
        attempt++;
        this.finalizationAttempts++;
        try {
          const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
          const timeoutId = controller ? setTimeout(() => controller.abort(), 8000) : null;

          const response = await fetch(this.sessionEndUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionTicket: this.sessionTicket,
              durationSeconds: elapsedSeconds,
              transcript: this.conversationTranscripts.map((t) => `${t.role}: ${t.text}`).join('\n'),
              reason,
            }),
            signal: controller?.signal,
          });

          if (timeoutId) clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          // Marked successful ONLY after successful HTTP 2xx response
          this.finalizationState = 'SUCCEEDED';
          this.finalizationError = null;
          this.finalizationPromise = null;
          return true;
        } catch (err: any) {
          this.finalizationError = err?.message || String(err);
          console.warn(`[DeepgramVoiceClient] Finalization attempt ${attempt}/${maxAttempts} failed:`, this.finalizationError);

          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, attempt * 150));
          }
        }
      }

      this.finalizationState = 'FAILED';
      this.finalizationPromise = null;
      return false;
    })();

    return this.finalizationPromise;
  }

  /**
   * Stop the session: performs immediate synchronous local cleanup
   * and dispatches backend finalization asynchronously.
   */
  public async stop(reason: string = 'USER_ENDED'): Promise<boolean> {
    // 1. Perform immediate, idempotent local cleanup of all hardware and network resources
    this.cleanup();
    this.setStatus('ended');

    // 2. Report session end to backend idempotently (state-tracked)
    return this.finalizeSession(reason);
  }

  /**
   * Full cleanup of audio resources and WebSocket.
   */
  private cleanup(): void {
    if (this.cleanedUp) return;
    this.cleanedUp = true;
    this.responseState = 'TERMINATED';
    this.suppressAudio = true;

    this.clearTimer();
    if (this.holdDrainTimer) {
      clearTimeout(this.holdDrainTimer);
      this.holdDrainTimer = null;
    }
    this.isReadyToSendAudio = false;

    // Stop and disconnect all active playback audio sources
    const sourcesToStop = [...this.activeSources];
    this.activeSources = [];
    for (const source of sourcesToStop) {
      try {
        source.stop();
        source.disconnect();
      } catch {}
    }
    this.nextPlayTime = 0;

    if (this.recordProcessor) {
      try {
        this.recordProcessor.disconnect();
      } catch {}
      this.recordProcessor = null;
    }

    if (this.recordSource) {
      try {
        this.recordSource.disconnect();
      } catch {}
      this.recordSource = null;
    }

    if (this.muteGain) {
      try {
        this.muteGain.disconnect();
      } catch {}
      this.muteGain = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }
}
