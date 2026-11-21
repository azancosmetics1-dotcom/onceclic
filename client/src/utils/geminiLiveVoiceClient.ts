/**
 * Gemini Live Voice Client for Browser
 * Connects directly to ONCEClic Backend WebSocket Bridge (/api/voice/live)
 * Powered by Google Gemini Live API.
 *
 * Audio specs:
 * - Microphone input: 16,000 Hz, 16-bit PCM mono (Base64 encoded)
 * - Speaker output: 24,000 Hz, 16-bit PCM mono (Base64 decoded)
 * - Interruption handling: Barge-in stops speaker instantly and resets audio queue
 * - Session ceiling: 180-second hard stop enforced locally and on backend
 * - Appointment reminder: 120-second prompt
 */

import { VoiceSessionStatus, BrowserVoiceCallbacks } from './vapiBrowserVoice';

export interface GeminiLiveClientOptions {
  wsUrl: string;
  sessionTicket: string;
  maxDurationSeconds?: number;
  appointmentReminderSeconds?: number;
  callbacks?: BrowserVoiceCallbacks;
}

export interface VoiceDiagnostics {
  microphonePermissionGranted: boolean;
  audioFramesSent: number;
  webSocketConnected: boolean;
  geminiSetupCompleted: boolean;
  geminiAudioChunksReceived: number;
  audioBytesDecoded: number;
  audioPlaybackStarted: boolean;
  audioPlaybackErrors: number;
  lastError?: string;
}

export class GeminiLiveVoiceClient {
  private wsUrl: string;
  private sessionTicket: string;
  private maxDurationSeconds: number;
  private appointmentReminderSeconds: number;
  private callbacks: BrowserVoiceCallbacks;

  private ws: WebSocket | null = null;
  private status: VoiceSessionStatus = 'idle';

  // Audio engine (unified for both recording and playback)
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private recordProcessor: ScriptProcessorNode | null = null;
  private recordSource: MediaStreamAudioSourceNode | null = null;
  private muteGain: GainNode | null = null;
  private isReadyToSendAudio: boolean = false;

  // Audio playback queue
  private nextPlayTime: number = 0;
  private activeSources: AudioBufferSourceNode[] = [];

  // Diagnostics tracker
  private diagnostics: VoiceDiagnostics = {
    microphonePermissionGranted: false,
    audioFramesSent: 0,
    webSocketConnected: false,
    geminiSetupCompleted: false,
    geminiAudioChunksReceived: 0,
    audioBytesDecoded: 0,
    audioPlaybackStarted: false,
    audioPlaybackErrors: 0,
  };

  // Timers
  private timerInterval: any = null;
  private callStartTimestamp: number | null = null;
  private reminderTriggered: boolean = false;

  constructor(options: GeminiLiveClientOptions) {
    this.wsUrl = options.wsUrl;
    this.sessionTicket = options.sessionTicket;
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

  public getDiagnostics(): VoiceDiagnostics {
    return { ...this.diagnostics };
  }

  private logDiag(message: string, meta?: any) {
    if (meta !== undefined) {
      console.log(`[VoiceDiag] ${message}`, meta);
    } else {
      console.log(`[VoiceDiag] ${message}`);
    }
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

      // 120-second appointment booking reminder
      if (
        !this.reminderTriggered &&
        elapsedSeconds >= this.appointmentReminderSeconds &&
        elapsedSeconds < this.maxDurationSeconds
      ) {
        this.reminderTriggered = true;
        this.callbacks.onAppointmentReminder?.();
      }

      // 180-second hard ceiling
      if (elapsedSeconds >= this.maxDurationSeconds) {
        this.clearTimer();
        this.stop('The maximum conversation limit of 3 minutes has been reached. Please book online or start a new inquiry.');
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
   * Start microphone capture and WebSocket bridge connection
   */
  async start(): Promise<void> {
    try {
      // 1. Request microphone permission
      this.setStatus('requesting_microphone');
      this.logDiag('Requesting microphone permission...');

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.diagnostics.microphonePermissionGranted = true;
      this.logDiag('Microphone permission granted.');

      // 2. Setup unified AudioContext (native hardware rate, e.g. 44100 or 48000 Hz)
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      this.nextPlayTime = this.audioContext.currentTime;

      // 3. Setup microphone capture & downsampling pipeline immediately while inside user gesture
      this.setupMicrophonePipeline();

      // 4. Connect to Backend WebSocket Bridge
      this.setStatus('connecting');
      this.logDiag('Connecting to voice WebSocket bridge...');

      const cleanUrl = this.wsUrl.includes('?')
        ? `${this.wsUrl}&ticket=${encodeURIComponent(this.sessionTicket)}`
        : `${this.wsUrl}?ticket=${encodeURIComponent(this.sessionTicket)}`;

      this.ws = new WebSocket(cleanUrl);

      this.ws.onopen = () => {
        this.diagnostics.webSocketConnected = true;
        this.logDiag('WebSocket connected. Waiting for Gemini Live setup...');
        this.setStatus('waiting_for_gemini');
      };

      this.ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleServerMessage(msg);
        } catch (err) {
          console.warn('[GeminiLiveClient] Non-JSON message received:', event.data);
        }
      };

      this.ws.onerror = (err) => {
        console.error('[GeminiLiveClient] WebSocket error:', err);
        this.diagnostics.lastError = 'Connection error to AI voice server';
        this.setStatus('error', 'Connection error to AI voice server');
      };

      this.ws.onclose = (event) => {
        this.clearTimer();
        this.stopAudioCapture();
        if (event.code === 4401) {
          this.setStatus('error', 'Voice session ticket expired or invalid');
        } else if (event.code === 4403) {
          this.setStatus('error', 'Minute allowance exhausted');
        } else {
          this.setStatus('ended');
        }
      };
    } catch (err: any) {
      this.stop();
      const errorMsg = err?.name === 'NotAllowedError'
        ? 'Microphone permission denied. Please allow microphone access to talk to the receptionist.'
        : (err?.message || 'Failed to start microphone or connection');
      this.setStatus('error', errorMsg);
      throw err;
    }
  }

  /**
   * Set up microphone capture pipeline on the unified AudioContext
   */
  private setupMicrophonePipeline(): void {
    if (!this.mediaStream || !this.audioContext) return;

    try {
      const inputSampleRate = this.audioContext.sampleRate || 48000;
      this.recordSource = this.audioContext.createMediaStreamSource(this.mediaStream);
      // ScriptProcessor captures 4096-sample windows (~85ms chunks)
      this.recordProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.recordProcessor.onaudioprocess = (e) => {
        if (!this.isReadyToSendAudio || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const inputChannel = e.inputBuffer.getChannelData(0);

        // Volume visualizer
        let sum = 0;
        for (let i = 0; i < inputChannel.length; i++) {
          sum += inputChannel[i] * inputChannel[i];
        }
        const rms = Math.sqrt(sum / inputChannel.length);
        this.callbacks.onVolumeLevel?.(Math.min(1, rms * 5));

        // Downsample input audio from native hardware rate (e.g. 48000Hz) to 16000Hz mono
        const downsampled = this.downsampleTo16k(inputChannel, inputSampleRate);

        // Convert Float32Array to 16-bit signed PCM little-endian
        const pcm16 = new Int16Array(downsampled.length);
        for (let i = 0; i < downsampled.length; i++) {
          const s = Math.max(-1, Math.min(1, downsampled[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Base64 encode safely
        const uint8 = new Uint8Array(pcm16.buffer);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < uint8.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, Array.from(uint8.subarray(i, i + chunkSize)));
        }
        const base64 = btoa(binary);

        this.ws.send(JSON.stringify({ type: 'audio', data: base64 }));
        this.diagnostics.audioFramesSent++;
        if (this.diagnostics.audioFramesSent === 1 || this.diagnostics.audioFramesSent % 25 === 0) {
          this.logDiag(`Microphone audio frame #${this.diagnostics.audioFramesSent} sent (${uint8.byteLength} bytes PCM16 at 16kHz)`);
        }
      };

      // Mute gain node connects to destination to keep ScriptProcessor running without speaker echo
      this.muteGain = this.audioContext.createGain();
      this.muteGain.gain.value = 0;
      this.recordSource.connect(this.recordProcessor);
      this.recordProcessor.connect(this.muteGain);
      this.muteGain.connect(this.audioContext.destination);

      this.logDiag('Microphone capture and streaming pipeline prepared on unified AudioContext.');
    } catch (err) {
      console.error('[GeminiLiveClient] Failed to setup mic processor:', err);
      this.logDiag('Failed to setup mic processor', err);
    }
  }

  /**
   * Anti-aliased downsampling from native input sample rate to 16,000 Hz
   */
  private downsampleTo16k(input: Float32Array, inputRate: number): Float32Array {
    if (inputRate === 16000) return input;
    const ratio = inputRate / 16000;
    const newLength = Math.round(input.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetInput = 0;
    while (offsetResult < result.length) {
      const nextOffsetInput = Math.round((offsetResult + 1) * ratio);
      let accum = 0;
      let count = 0;
      for (let i = offsetInput; i < nextOffsetInput && i < input.length; i++) {
        accum += input[i];
        count++;
      }
      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetInput = nextOffsetInput;
    }
    return result;
  }

  /**
   * Handle incoming message from backend bridge
   */
  private async handleServerMessage(msg: any): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.diagnostics.geminiSetupCompleted = true;
        this.logDiag('Gemini setup completed (session ready). Enabling microphone stream...');
        if (this.audioContext && this.audioContext.state === 'suspended') {
          this.audioContext.resume().catch(() => {});
        }
        this.isReadyToSendAudio = true;
        this.setStatus('listening');
        this.startTimer();
        break;

      case 'audio':
        if (msg.data) {
          this.diagnostics.geminiAudioChunksReceived++;
          this.playAudioChunk(msg.data);
        }
        break;

      case 'interrupted':
        this.logDiag('Gemini Live session interrupted by user speech.');
        this.handleInterruption();
        break;

      case 'transcript':
        if (msg.text) {
          this.callbacks.onTranscript?.(msg.role === 'user' ? 'user' : 'assistant', msg.text);
        }
        break;

      case 'appointment_reminder':
        this.callbacks.onAppointmentReminder?.();
        break;

      case 'duration_warning':
        console.warn(`[GeminiLiveClient] Duration warning: ${msg.remainingSeconds}s remaining`);
        break;

      case 'ended':
        this.logDiag(`Session ended: ${msg.reason || 'Normal closure'}`);
        this.stop(msg.reason);
        break;

      case 'error':
        console.error('[GeminiLiveClient] Server error:', msg.error);
        this.diagnostics.lastError = msg.error;
        this.setStatus('error', msg.error);
        break;
    }
  }

  /**
   * Play incoming 24kHz PCM audio chunk
   */
  private playAudioChunk(base64Audio: string): void {
    if (!this.audioContext) return;

    try {
      // Ensure playback AudioContext is running
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }

      // Decode base64 to binary PCM16
      const binary = atob(base64Audio);
      const byteLen = binary.length;
      const sampleCount = Math.floor(byteLen / 2);
      if (sampleCount === 0) return;

      this.diagnostics.audioBytesDecoded += byteLen;

      // Extract 16-bit signed PCM little-endian samples directly into normalized Float32
      const float32 = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        const b1 = binary.charCodeAt(i * 2);
        const b2 = binary.charCodeAt(i * 2 + 1);
        let int16 = b1 | (b2 << 8);
        if (int16 >= 0x8000) int16 -= 0x10000;
        float32[i] = int16 / 32768.0;
      }

      // Create AudioBuffer at 24000 Hz mono (Gemini native output rate)
      // The browser AudioContext destination automatically resamples to hardware rate (e.g. 48kHz)
      const audioBuffer = this.audioContext.createBuffer(1, sampleCount, 24000);
      audioBuffer.getChannelData(0).set(float32);

      // Schedule gapless playback
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);

      const currentTime = this.audioContext.currentTime;
      const startTime = Math.max(currentTime, this.nextPlayTime);
      source.start(startTime);
      this.nextPlayTime = startTime + audioBuffer.duration;

      this.activeSources.push(source);
      this.diagnostics.audioPlaybackStarted = true;
      this.setStatus('speaking');

      if (this.diagnostics.geminiAudioChunksReceived % 10 === 1) {
        this.logDiag(`Audio playback scheduled at ${startTime.toFixed(3)}s (duration ${audioBuffer.duration.toFixed(3)}s, chunk #${this.diagnostics.geminiAudioChunksReceived})`);
      }

      source.onended = () => {
        const idx = this.activeSources.indexOf(source);
        if (idx !== -1) {
          this.activeSources.splice(idx, 1);
        }
        if (this.activeSources.length === 0) {
          if (this.status === 'speaking') {
            this.setStatus('listening');
          }
        }
      };
    } catch (err: any) {
      console.error('[GeminiLiveClient] Audio playback error:', err);
      this.diagnostics.audioPlaybackErrors++;
      this.diagnostics.lastError = err?.message || 'Audio playback error';
      this.logDiag('Audio playback error', err?.message || err);
    }
  }

  /**
   * Barge-in interruption: immediately stop speaker playback and reset queue
   */
  private handleInterruption(): void {
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
    this.setStatus('listening');
  }

  /**
   * Stop session, clean up audio contexts and close WebSocket
   */
  stop(reason?: string): void {
    this.clearTimer();
    this.handleInterruption();
    this.stopAudioCapture();

    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }

    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'end' }));
          this.ws.close(1000, reason || 'User ended session');
        }
      } catch {}
      this.ws = null;
    }

    this.setStatus('ended', reason);
  }

  private stopAudioCapture(): void {
    this.isReadyToSendAudio = false;

    if (this.recordProcessor) {
      try {
        this.recordProcessor.disconnect();
        this.recordProcessor.onaudioprocess = null;
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
      this.mediaStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      this.mediaStream = null;
    }
  }

  getStatus(): VoiceSessionStatus {
    return this.status;
  }

  getMaxDurationSeconds(): number {
    return this.maxDurationSeconds;
  }

  getAppointmentReminderSeconds(): number {
    return this.appointmentReminderSeconds;
  }
}
