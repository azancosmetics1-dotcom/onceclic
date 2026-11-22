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

export interface DeepgramVoiceClientOptions {
  deepgramToken: string;
  deepgramWsUrl?: string;
  sessionTicket: string;
  settings: any;
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
  private sessionTicket: string;
  private settings: any;
  private toolEndpointUrl: string;
  private sessionEndUrl: string;
  private maxDurationSeconds: number;
  private appointmentReminderSeconds: number;
  private callbacks: BrowserVoiceCallbacks;

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

  constructor(options: DeepgramVoiceClientOptions) {
    this.deepgramToken = options.deepgramToken;
    this.wsUrl = options.deepgramWsUrl || 'wss://agent.deepgram.com/v1/agent/converse';
    this.sessionTicket = options.sessionTicket;
    this.settings = options.settings;
    this.toolEndpointUrl = options.toolEndpointUrl || '/api/voice/tools/execute';
    this.sessionEndUrl = options.sessionEndUrl || '/api/voice/session/end';
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
          // Wait for Welcome event from Deepgram before sending Settings
        };

        ws.onmessage = async (event: MessageEvent) => {
          // Binary audio data from Deepgram
          if (event.data instanceof ArrayBuffer) {
            this.handleIncomingAudio(new Uint8Array(event.data));
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

        ws.onerror = (err) => {
          console.error('[DeepgramVoiceClient] WebSocket error:', err);
          if (!connectionSettled) {
            connectionSettled = true;
            reject(new Error('Failed to connect to Deepgram Voice Agent service.'));
          }
        };

        ws.onclose = (event) => {
          console.log(`[DeepgramVoiceClient] WebSocket closed (code: ${event.code}, reason: "${event.reason}")`);
          if (this.status !== 'ended') {
            if (event.code === 1008 || event.code === 4401) {
              this.setStatus('error', 'Voice authentication token expired or invalid.');
            } else if (event.code !== 1000) {
              this.setStatus('ended');
            }
          }
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
   * Handle Deepgram Voice Agent JSON events
   */
  private async handleServerEvent(msg: any): Promise<void> {
    const eventType = msg.type;

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
        // Interruption / Barge-in: ignore if call is already ended
        if (this.isCallEnded) break;
        this.diagnostics.interruptionsDetected++;
        this.interruptPlayback();
        this.setStatus('listening');
        if (this.currentTurnRole !== 'user') {
          this.turnSequence++;
          this.currentTurnRole = 'user';
          this.currentTurnId = `turn_user_${this.turnSequence}_${Date.now()}`;
          this.currentTurnText = '';
        }
        break;

      case 'AgentStartedSpeaking':
        // If call is ended but goodbye audio is still playing, that is intentional — let it play.
        // But do NOT start a new agent turn for new audio after the call ended.
        if (!this.isCallEnded) {
          this.setStatus('speaking');
        }
        if (this.currentTurnRole !== 'assistant' && !this.isCallEnded) {
          this.turnSequence++;
          this.currentTurnRole = 'assistant';
          this.currentTurnId = `turn_assistant_${this.turnSequence}_${Date.now()}`;
          this.currentTurnText = '';

          // -----------------------------------------------------------------------
          // AUDIO OVERLAP FIX: Every new assistant response must start on a clean
          // audio timeline. If the previous response is still playing (nextPlayTime
          // is ahead of the current clock), stop it immediately and reset the queue
          // so the new response's first chunk plays RIGHT NOW, not after the
          // previous response's tail audio finishes.
          //
          // This is different from barge-in (UserStartedSpeaking): barge-in is
          // triggered by the USER interrupting; this is triggered by DEEPGRAM
          // starting a NEW agent turn — which must never overlap the prior turn.
          // -----------------------------------------------------------------------
          this.flushAudioQueue();
        }
        break;

      case 'AgentThinking':
        // Deepgram think model is generating response
        break;

      case 'AgentAudioDone':
        // Per Deepgram docs: AgentAudioDone fires ONCE per complete agent response (not per chunk).
        // The audio buffer may still be playing client-side when this fires, so we must wait
        // for the queued audio to drain before changing state or closing the session.
        if (this.pendingCallEnd && !this.goodbyeAudioDraining) {
          this.goodbyeAudioDraining = true;
          // Calculate how long the queued audio still needs to play.
          // nextPlayTime is the WebAudio clock time when the last queued buffer ends.
          // audioContext.currentTime is the current clock. The difference is the remaining play time.
          const audioCtx = this.audioContext;
          let drainMs = 500; // safe minimum
          if (audioCtx) {
            const remaining = this.nextPlayTime - audioCtx.currentTime;
            // remaining is in seconds; clamp between 0.5s and 8s
            drainMs = Math.min(8000, Math.max(500, Math.ceil(remaining * 1000) + 400));
          }
          setTimeout(() => {
            this.stop('NORMAL_END');
          }, drainMs);
          return;
        }
        // Normal (non-goodbye) turn end: transition back to listening
        if (!this.pendingCallEnd && !this.isCallEnded && this.status === 'speaking') {
          // Reset the tool-call-in-flight flag: the agent has finished its turn
          this.toolCallInFlight = false;
          setTimeout(() => {
            if (this.status === 'speaking' && !this.isCallEnded && !this.pendingCallEnd) {
              this.setStatus('listening');
            }
          }, 300);
        }
        break;

      case 'ConversationText':
        if (msg.role && msg.content) {
          // Drop all events once call has ended (goodbye already delivered)
          if (this.isCallEnded) break;

          const role: 'user' | 'assistant' = msg.role === 'user' ? 'user' : 'assistant';
          const rawText = typeof msg.content === 'string' ? msg.content.trim() : '';
          if (!rawText) break;

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
          // When a FunctionCallRequest was in-flight and the next assistant ConversationText arrives,
          // it is the tool result response — semantically the same turn. Merge it into the last
          // assistant bubble instead of creating a new one.
          // We only merge when: (a) this is a new assistant turn AND (b) toolCallInFlight was set,
          // meaning Deepgram just finished executing a tool and is now responding to its result.
          // This avoids merging genuinely distinct assistant turns that happen to follow each other.
          if (isNewTurn && role === 'assistant' && this.toolCallInFlight) {
            this.toolCallInFlight = false; // consume the flag
            const lastAssistantIndex = this.conversationTranscripts.length - 1;
            if (
              lastAssistantIndex >= 0 &&
              this.conversationTranscripts[lastAssistantIndex].role === 'assistant'
            ) {
              // Update the existing assistant bubble with the tool-follow-up response
              const prevTurnId = this.currentTurnId;
              this.currentTurnText = rawText;
              this.lastEmittedRole = role;
              this.lastEmittedText = rawText;
              this.lastEmittedTime = now;
              this.conversationTranscripts[lastAssistantIndex].text = rawText;
              this.callbacks.onTranscript?.(role, rawText, prevTurnId, false);
              break;
            }
            // No previous assistant bubble — fall through to create a new one
          } else if (role === 'assistant') {
            // Clear the flag for any other assistant ConversationText (not a tool follow-up)
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
        // Mark that a tool call is now in-flight; the next assistant ConversationText
        // after this resolves is a tool-call follow-up (same logical turn, not a new one).
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
   * Each chunk is tagged with the currentResponseSeq so stale chunks from a
   * previous response that arrive late are silently discarded BEFORE they are
   * ever scheduled on the WebAudio clock.
   */
  private handleIncomingAudio(rawBytes: Uint8Array): void {
    if (!this.audioContext || rawBytes.byteLength < 2) return;

    // ── GUARD (pre-schedule) ─────────────────────────────────────────────────
    // Capture the response sequence ID RIGHT NOW, before any decode work.
    // If flushAudioQueue() fires between here and source.start() the guard
    // below will catch it and discard the chunk before it touches the WebAudio
    // scheduler.  This is the only correct placement — checking AFTER start()
    // is too late because the source is already enqueued on the audio clock.
    const mySeq = this.currentResponseSeq;

    this.diagnostics.audioChunksReceived++;
    this.diagnostics.audioBytesDecoded += rawBytes.byteLength;

    // Convert raw PCM16 bytes to Float32 samples (synchronous — no async gap)
    const pcm16 = new Int16Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength / 2);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768.0;
    }

    const sampleRate = 24000;
    const audioBuffer = this.audioContext.createBuffer(1, float32.length, sampleRate);
    audioBuffer.getChannelData(0).set(float32);

    // ── GUARD (pre-start) ────────────────────────────────────────────────────
    // Re-check seq after PCM decode.  Although decode is synchronous, another
    // WebSocket binary frame (triggering a flush) could have been processed in
    // the same JS microtask queue.  Checking here guarantees we never call
    // source.start() for a superseded response.
    if (mySeq !== this.currentResponseSeq) return;

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
    // No post-start seq check needed: the pre-start guard above ensures only
    // chunks belonging to the current response ever reach source.start().
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
      for (const source of this.activeSources) {
        try {
          source.stop();
          source.disconnect();
        } catch {}
      }
      this.activeSources = [];
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

    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {}
    }
    this.activeSources = [];
    if (this.audioContext) {
      this.nextPlayTime = this.audioContext.currentTime;
    }
  }

  /**
   * Stop the session, report duration to backend, and clean up resources.
   */
  public async stop(reason: string = 'USER_ENDED'): Promise<void> {
    const elapsedSeconds = this.callStartTimestamp
      ? Math.floor((Date.now() - this.callStartTimestamp) / 1000)
      : 0;

    this.clearTimer();
    this.isReadyToSendAudio = false;
    this.interruptPlayback();

    // Report session end to backend
    if (elapsedSeconds > 0 && this.sessionTicket) {
      try {
        await fetch(this.sessionEndUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionTicket: this.sessionTicket,
            durationSeconds: elapsedSeconds,
            transcript: this.conversationTranscripts.map((t) => `${t.role}: ${t.text}`).join('\n'),
            reason,
          }),
        });
      } catch (endErr) {
        console.warn('[DeepgramVoiceClient] Error finalizing session duration:', endErr);
      }
    }

    this.cleanup();
    this.setStatus('ended');
  }

  /**
   * Full cleanup of audio resources and WebSocket.
   */
  private cleanup(): void {
    this.clearTimer();
    this.isReadyToSendAudio = false;

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
