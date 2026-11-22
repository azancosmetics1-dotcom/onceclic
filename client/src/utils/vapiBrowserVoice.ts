/**
 * Browser Voice Helper for Vapi Web SDK
 * Connects website visitors and dashboard users to their dedicated AI Voice Receptionist
 * using the visitor's browser microphone and speakers without any phone number or PSTN connection.
 *
 * Enforces:
 * - Universal 180-second (3-minute) hard conversation maximum
 * - Appointment reminder at 120 seconds of active conversation
 * - Accurate timer starting ONLY when active voice conversation starts
 */

import { DeepgramVoiceClient } from './deepgramVoiceClient';
import { GeminiLiveVoiceClient } from './geminiLiveVoiceClient';

declare global {
  interface Window {
    vapiSDK?: any;
    vapiInstance?: any;
  }
}

export type VoiceSessionStatus =
  | 'idle'
  | 'requesting_microphone'
  | 'connecting'
  | 'waiting_for_gemini'
  | 'ready'
  | 'active'
  | 'listening'
  | 'speaking'
  | 'reconnecting'
  | 'ended'
  | 'error'
  | 'loading_sdk';

export interface BrowserVoiceCallbacks {
  onStatusChange?: (status: VoiceSessionStatus, error?: string) => void;
  onVolumeLevel?: (volume: number) => void;
  onTranscript?: (role: 'user' | 'assistant', text: string, turnId?: string, isNewTurn?: boolean) => void;
  onAppointmentReminder?: () => void;
  onTimerTick?: (elapsedSeconds: number, remainingSeconds: number) => void;
}

export interface BrowserVoiceSessionParams {
  provider?: 'deepgram_voice_agent' | 'gemini_live' | 'vapi' | 'modular_voice';
  sessionTicket?: string;
  deepgramToken?: string;
  deepgramWsUrl?: string;
  sttWsUrl?: string;
  voiceTurnUrl?: string;
  pipeline?: string;
  settings?: any;
  toolEndpointUrl?: string;
  sessionEndUrl?: string;
  wsUrl?: string;
  assistantId?: string;
  publicKey?: string;
  maxDurationSeconds?: number;
  appointmentReminderSeconds?: number;
  callbacks?: BrowserVoiceCallbacks;
}

let vapiScriptLoadingPromise: Promise<void> | null = null;

export function loadVapiScript(): Promise<void> {
  if (window.vapiSDK) {
    return Promise.resolve();
  }

  if (vapiScriptLoadingPromise) {
    return vapiScriptLoadingPromise;
  }

  vapiScriptLoadingPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[src*="VapiAI"]');
    if (existingScript && window.vapiSDK) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/gh/VapiAI/html-script-tag@latest/dist/assets/index.js';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      resolve();
    };
    script.onerror = (err) => {
      vapiScriptLoadingPromise = null;
      reject(new Error('Failed to load Vapi Web SDK for browser voice.'));
    };
    document.head.appendChild(script);
  });

  return vapiScriptLoadingPromise;
}

export class BrowserVoiceSession {
  private deepgramClient: DeepgramVoiceClient | null = null;
  private geminiClient: GeminiLiveVoiceClient | null = null;
  private vapi: any = null;
  private assistantId: string;
  private publicKey: string;
  private callbacks: BrowserVoiceCallbacks;
  private status: VoiceSessionStatus = 'idle';
  private maxDurationSeconds: number;
  private appointmentReminderSeconds: number;
  private timerInterval: any = null;
  private callStartTimestamp: number | null = null;
  private reminderTriggered: boolean = false;

  constructor(params: BrowserVoiceSessionParams) {
    this.assistantId = params.assistantId || '';
    this.publicKey = params.publicKey || '';
    this.maxDurationSeconds = params.maxDurationSeconds || 180;
    this.appointmentReminderSeconds = params.appointmentReminderSeconds || 120;
    this.callbacks = params.callbacks || {};

    // Primary: Modular Voice Pipeline (Deepgram Nova-2 STT + ONCEClic Server Orchestrator + Deepgram Aura TTS)
    if (params.provider === 'modular_voice' || params.provider === 'deepgram_voice_agent' || params.deepgramToken || params.settings) {
      this.deepgramClient = new DeepgramVoiceClient({
        deepgramToken: params.deepgramToken || '',
        deepgramWsUrl: params.deepgramWsUrl,
        sttWsUrl: params.sttWsUrl,
        voiceTurnUrl: params.voiceTurnUrl,
        pipeline: params.pipeline,
        sessionTicket: params.sessionTicket || '',
        settings: params.settings,
        toolEndpointUrl: params.toolEndpointUrl,
        sessionEndUrl: params.sessionEndUrl,
        maxDurationSeconds: this.maxDurationSeconds,
        appointmentReminderSeconds: this.appointmentReminderSeconds,
        callbacks: {
          ...this.callbacks,
          onStatusChange: (status, err) => {
            this.status = status;
            this.callbacks.onStatusChange?.(status, err);
          },
        },
      });
      return;
    }

    // Fallback: Legacy Gemini Live Web Audio API if sessionTicket is provided or provider is gemini_live
    if (params.sessionTicket || params.provider === 'gemini_live') {
      let targetWsUrl = params.wsUrl;
      if (!targetWsUrl || targetWsUrl.startsWith('/')) {
        const isSecure = window.location.protocol === 'https:';
        const wsScheme = isSecure ? 'wss:' : 'ws:';
        const host = window.location.hostname;
        const isOnceclicProd = host === 'onceclic.com' || host.endsWith('.onceclic.com') || host.endsWith('.netlify.app');
        const apiHost = isOnceclicProd ? 'api.onceclic.com' : window.location.host;
        const path = targetWsUrl && targetWsUrl.startsWith('/') ? targetWsUrl : '/api/voice/live';
        targetWsUrl = `${wsScheme}//${apiHost}${path}`;
      }

      this.geminiClient = new GeminiLiveVoiceClient({
        wsUrl: targetWsUrl,
        sessionTicket: params.sessionTicket || '',
        maxDurationSeconds: this.maxDurationSeconds,
        appointmentReminderSeconds: this.appointmentReminderSeconds,
        callbacks: {
          ...this.callbacks,
          onStatusChange: (status, err) => {
            this.status = status;
            this.callbacks.onStatusChange?.(status, err);
          },
        },
      });
    }
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

      // Trigger appointment reminder at 120s into conversation
      if (
        !this.reminderTriggered &&
        elapsedSeconds >= this.appointmentReminderSeconds &&
        elapsedSeconds < this.maxDurationSeconds
      ) {
        this.reminderTriggered = true;
        this.callbacks.onAppointmentReminder?.();
      }

      // Hard stop at 180s (max conversation limit)
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

  async start(): Promise<void> {
    if (this.deepgramClient) {
      return this.deepgramClient.start();
    }
    if (this.geminiClient) {
      return this.geminiClient.start();
    }

    try {
      this.setStatus('loading_sdk');
      await loadVapiScript();

      if (!window.vapiSDK && !(window as any).Vapi) {
        throw new Error('Vapi Web SDK is not available.');
      }

      const VapiConstructor = window.vapiSDK?.run ? null : ((window as any).Vapi || window.vapiSDK);

      this.setStatus('connecting');

      if (VapiConstructor && typeof VapiConstructor === 'function') {
        this.vapi = new VapiConstructor(this.publicKey);
      } else if (window.vapiSDK?.run) {
        // Alternative CDN instance runner
        this.vapi = window.vapiSDK.run({
          apiKey: this.publicKey,
          assistant: this.assistantId,
        });
        this.setStatus('active');
        this.startTimer();
        return;
      } else {
        throw new Error('Vapi client constructor could not be initialized.');
      }

      this.vapi.on('call-start', () => {
        this.setStatus('active');
        // Timer strictly starts when voice conversation becomes active, not during mic permission/connecting
        this.startTimer();
      });

      this.vapi.on('call-end', () => {
        this.clearTimer();
        this.setStatus('ended');
      });

      this.vapi.on('speech-start', () => {
        this.setStatus('speaking');
      });

      this.vapi.on('speech-end', () => {
        this.setStatus('listening');
      });

      this.vapi.on('volume-level', (volume: number) => {
        this.callbacks.onVolumeLevel?.(volume);
      });

      this.vapi.on('message', (message: any) => {
        if (message.type === 'transcript') {
          if (message.transcriptType === 'final') {
            this.callbacks.onTranscript?.(
              message.role === 'user' ? 'user' : 'assistant',
              message.transcript
            );
          }
        }
      });

      this.vapi.on('error', (err: any) => {
        console.error('[BrowserVoiceSession] Vapi error:', err);
        const errMsg = err?.message || err?.errorMsg || 'Voice session error';
        this.clearTimer();
        this.setStatus('error', errMsg);
      });

      // Start the voice call with the dedicated assistant
      await this.vapi.start(this.assistantId);
    } catch (err: any) {
      console.error('[BrowserVoiceSession] Start failed:', err);
      this.clearTimer();
      this.setStatus('error', err?.message || 'Failed to start browser voice session');
      throw err;
    }
  }

  stop(reason?: string): void {
    this.clearTimer();
    if (this.deepgramClient) {
      this.deepgramClient.stop(reason);
      this.setStatus('ended', reason);
      return;
    }
    if (this.geminiClient) {
      this.geminiClient.stop(reason);
      this.setStatus('ended', reason);
      return;
    }
    try {
      if (this.vapi) {
        this.vapi.stop?.();
      }
    } catch (err) {
      console.warn('[BrowserVoiceSession] Stop error:', err);
    } finally {
      this.setStatus('ended', reason);
    }
  }

  getStatus(): VoiceSessionStatus {
    if (this.geminiClient) {
      return this.geminiClient.getStatus();
    }
    return this.status;
  }

  getMaxDurationSeconds(): number {
    return this.maxDurationSeconds;
  }

  getAppointmentReminderSeconds(): number {
    return this.appointmentReminderSeconds;
  }
}
