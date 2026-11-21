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

export class GeminiLiveVoiceClient {
  private wsUrl: string;
  private sessionTicket: string;
  private maxDurationSeconds: number;
  private appointmentReminderSeconds: number;
  private callbacks: BrowserVoiceCallbacks;

  private ws: WebSocket | null = null;
  private status: VoiceSessionStatus = 'idle';

  // Audio recording
  private mediaStream: MediaStream | null = null;
  private audioRecordContext: AudioContext | null = null;
  private recordProcessor: ScriptProcessorNode | null = null;
  private recordSource: MediaStreamAudioSourceNode | null = null;

  // Audio playback
  private audioPlayContext: AudioContext | null = null;
  private nextPlayTime: number = 0;
  private activeSources: AudioBufferSourceNode[] = [];

  // Timers
  private timerInterval: any = null;
  private callStartTimestamp: number | null = null;
  private reminderTriggered: boolean = false;
  private speakingTimeout: any = null;

  constructor(options: GeminiLiveClientOptions) {
    this.wsUrl = options.wsUrl;
    this.sessionTicket = options.sessionTicket;
    this.maxDurationSeconds = options.maxDurationSeconds || 180;
    this.appointmentReminderSeconds = options.appointmentReminderSeconds || 120;
    this.callbacks = options.callbacks || {};
  }

  private setStatus(status: VoiceSessionStatus, error?: string) {
    this.status = status;
    this.callbacks.onStatusChange?.(status, error);
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
      this.setStatus('connecting');

      // 1. Request microphone access (16kHz mono preferred)
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // 2. Setup playback AudioContext (24kHz for Gemini Live audio)
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioPlayContext = new AudioCtx({ sampleRate: 24000 });
      if (this.audioPlayContext.state === 'suspended') {
        await this.audioPlayContext.resume();
      }
      this.nextPlayTime = this.audioPlayContext.currentTime;

      // 3. Connect to Backend WebSocket Bridge
      const cleanUrl = this.wsUrl.includes('?')
        ? `${this.wsUrl}&ticket=${encodeURIComponent(this.sessionTicket)}`
        : `${this.wsUrl}?ticket=${encodeURIComponent(this.sessionTicket)}`;

      this.ws = new WebSocket(cleanUrl);

      this.ws.onopen = () => {
        this.startMicrophoneCapture();
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
      this.setStatus('error', err?.message || 'Failed to start microphone or connection');
      throw err;
    }
  }

  /**
   * Start streaming microphone PCM chunks to backend
   */
  private startMicrophoneCapture(): void {
    if (!this.mediaStream) return;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioRecordContext = new AudioCtx({ sampleRate: 16000 });
      this.recordSource = this.audioRecordContext.createMediaStreamSource(this.mediaStream);

      // ScriptProcessorNode captures 4096-sample buffers (~256ms at 16kHz)
      this.recordProcessor = this.audioRecordContext.createScriptProcessor(4096, 1, 1);

      this.recordProcessor.onaudioprocess = (e) => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);
        // Measure input volume for visualizer
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        this.callbacks.onVolumeLevel?.(Math.min(1, rms * 5));

        // Convert Float32Array to 16-bit PCM little-endian
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Base64 encode
        const uint8 = new Uint8Array(pcm16.buffer);
        let binary = '';
        for (let i = 0; i < uint8.byteLength; i++) {
          binary += String.fromCharCode(uint8[i]);
        }
        const base64 = btoa(binary);

        this.ws.send(JSON.stringify({ type: 'audio', data: base64 }));
      };

      this.recordSource.connect(this.recordProcessor);
      this.recordProcessor.connect(this.audioRecordContext.destination);
    } catch (err) {
      console.error('[GeminiLiveClient] Failed to setup mic processor:', err);
    }
  }

  /**
   * Handle incoming message from backend bridge
   */
  private async handleServerMessage(msg: any): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.setStatus('active');
        this.startTimer();
        break;

      case 'audio':
        if (msg.data) {
          this.playAudioChunk(msg.data);
        }
        break;

      case 'interrupted':
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
        this.stop(msg.reason);
        break;

      case 'error':
        console.error('[GeminiLiveClient] Server error:', msg.error);
        this.setStatus('error', msg.error);
        break;
    }
  }

  /**
   * Play incoming 24kHz PCM audio chunk
   */
  private playAudioChunk(base64Audio: string): void {
    if (!this.audioPlayContext) return;

    try {
      this.setStatus('speaking');
      if (this.speakingTimeout) clearTimeout(this.speakingTimeout);
      this.speakingTimeout = setTimeout(() => {
        if (this.status === 'speaking') {
          this.setStatus('listening');
        }
      }, 400);

      // Decode base64 to binary PCM16
      const binary = atob(base64Audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const pcm16 = new Int16Array(bytes.buffer);

      // Create AudioBuffer at 24kHz mono
      const audioBuffer = this.audioPlayContext.createBuffer(1, pcm16.length, 24000);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < pcm16.length; i++) {
        channelData[i] = pcm16[i] / 32768.0;
      }

      // Schedule seamless audio playback
      const source = this.audioPlayContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioPlayContext.destination);

      const currentTime = this.audioPlayContext.currentTime;
      const startTime = Math.max(currentTime, this.nextPlayTime);
      source.start(startTime);
      this.nextPlayTime = startTime + audioBuffer.duration;

      this.activeSources.push(source);
      source.onended = () => {
        const idx = this.activeSources.indexOf(source);
        if (idx !== -1) this.activeSources.splice(idx, 1);
      };
    } catch (err) {
      console.error('[GeminiLiveClient] Audio playback error:', err);
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
    if (this.audioPlayContext) {
      this.nextPlayTime = this.audioPlayContext.currentTime;
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

    if (this.audioPlayContext) {
      try {
        this.audioPlayContext.close();
      } catch {}
      this.audioPlayContext = null;
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
    if (this.audioRecordContext) {
      try {
        this.audioRecordContext.close();
      } catch {}
      this.audioRecordContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
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
