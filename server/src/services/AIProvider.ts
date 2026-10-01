import OpenAI from 'openai';
import { config } from '../config';

export interface ChatMessageParam {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateResponseParams {
  messages: ChatMessageParam[];
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateResponseResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  model: string;
  provider: string;
  handoffRequired?: boolean;
}

export interface IAIProvider {
  readonly providerName: string;
  readonly modelName: string;
  healthCheck(): Promise<{ available: boolean; provider: string; model: string; error?: string }>;
  generateResponse(params: GenerateResponseParams): Promise<GenerateResponseResult>;
  generateEmbedding(text: string): Promise<number[]>;
  calculateCost(model: string, promptTokens: number, completionTokens: number): number;
  estimateCost(model: string, promptTokens: number, completionTokens: number): number;
}

/**
 * OpenAI Provider Implementation
 */
export class OpenAIProvider implements IAIProvider {
  readonly providerName = 'OpenAI';
  private client: OpenAI | null = null;
  private chatModel: string;
  private embeddingModel: string;

  constructor(apiKey?: string, chatModel?: string, embeddingModel?: string) {
    this.chatModel = chatModel || config.openai.chatModel;
    this.embeddingModel = embeddingModel || config.openai.embeddingModel;
    const key = apiKey ?? config.openai.apiKey;
    if (key && !key.includes('placeholder')) {
      this.client = new OpenAI({ apiKey: key, maxRetries: 1 });
    }
  }

  get modelName(): string {
    return this.chatModel;
  }

  async healthCheck(): Promise<{ available: boolean; provider: string; model: string; error?: string }> {
    if (!this.client || !config.openai.apiKey || config.openai.apiKey.includes('placeholder')) {
      return {
        available: false,
        provider: 'OpenAI',
        model: this.chatModel,
        error: 'OPENAI_API_KEY is not configured on the server. Please set a valid API key in server environment.',
      };
    }

    try {
      await this.client.models.retrieve(this.chatModel);
      return {
        available: true,
        provider: 'OpenAI',
        model: this.chatModel,
      };
    } catch (err: any) {
      return {
        available: false,
        provider: 'OpenAI',
        model: this.chatModel,
        error: err.message || 'Failed to authenticate with OpenAI API.',
      };
    }
  }

  async generateResponse(params: GenerateResponseParams): Promise<GenerateResponseResult> {
    if (!this.client) {
      throw new Error(
        'AI Provider is unavailable: OPENAI_API_KEY is not configured. Please configure your OpenAI API key in dashboard settings.'
      );
    }

    try {
      const completion = await this.client.chat.completions.create({
        model: this.chatModel,
        messages: params.messages,
        temperature: params.temperature ?? 0.3,
        max_tokens: params.maxTokens ?? 500,
      });

      const choice = completion.choices[0];
      const content = choice?.message?.content || '';
      const usage = completion.usage;

      const promptTokens = usage?.prompt_tokens || 0;
      const completionTokens = usage?.completion_tokens || 0;
      const totalTokens = usage?.total_tokens || 0;

      const estimatedCostUsd = this.calculateCost(this.chatModel, promptTokens, completionTokens);

      const handoffRequired =
        content.includes('[HUMAN_HANDOFF_REQUESTED]') ||
        content.toLowerCase().includes('connect you with a human') ||
        content.toLowerCase().includes('hand this conversation over to our staff');

      const cleanContent = content.replace(/\[HUMAN_HANDOFF_REQUESTED\]/g, '').trim();

      return {
        content: cleanContent,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd,
        model: this.chatModel,
        provider: 'OpenAI',
        handoffRequired,
      };
    } catch (err: any) {
      console.error('[OpenAIProvider] Generation failed:', err);
      throw new Error(`OpenAI generation error: ${err.message}`);
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.client) {
      throw new Error('AI Provider is unavailable: OPENAI_API_KEY is not configured for generating embeddings.');
    }

    try {
      const response = await this.client.embeddings.create({
        model: this.embeddingModel,
        input: text.replace(/\n/g, ' ').substring(0, 8000),
      });

      return response.data[0].embedding;
    } catch (err: any) {
      console.error('[OpenAIProvider] Embedding failed:', err);
      throw new Error(`OpenAI embedding error: ${err.message}`);
    }
  }

  calculateCost(model: string, promptTokens: number, completionTokens: number): number {
    let promptRate = 0.00000015;
    let completionRate = 0.0000006;

    if (model.includes('gpt-4o') && !model.includes('mini')) {
      promptRate = 0.000005;
      completionRate = 0.000015;
    }

    const cost = promptTokens * promptRate + completionTokens * completionRate;
    return Math.round(cost * 1000000) / 1000000;
  }

  estimateCost(model: string, promptTokens: number, completionTokens: number): number {
    return this.calculateCost(model, promptTokens, completionTokens);
  }
}

/**
 * Google Gemini Provider Implementation
 * Uses Google's official Gemini Developer API (Google AI Studio REST architecture)
 */
export class GeminiProvider implements IAIProvider {
  readonly providerName = 'Gemini';
  private apiKey: string;
  private model: string;
  private embeddingModel: string;
  private apiBaseUrl: string;

  constructor(apiKey?: string, model?: string, embeddingModel?: string, apiBaseUrl?: string) {
    this.apiKey = apiKey ?? config.gemini.apiKey;
    this.model = model ?? config.gemini.model;
    this.embeddingModel = embeddingModel ?? config.gemini.embeddingModel;
    this.apiBaseUrl = (apiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  }

  get modelName(): string {
    return this.model;
  }

  private isConfigured(): boolean {
    return !!this.apiKey && !this.apiKey.includes('placeholder') && this.apiKey.trim().length > 0;
  }

  private sanitizeErrorMessage(msg: string): string {
    if (!this.apiKey) return msg;
    // Strip key from error message or query string if present
    const keyRegex = new RegExp(this.apiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    return msg.replace(keyRegex, '[REDACTED_API_KEY]').replace(/key=[a-zA-Z0-9_\-]+/g, 'key=[REDACTED]');
  }

  async healthCheck(): Promise<{ available: boolean; provider: string; model: string; error?: string }> {
    if (!this.isConfigured()) {
      return {
        available: false,
        provider: 'Gemini',
        model: this.model,
        error: 'GEMINI_API_KEY is not configured on the server. Please set a valid API key in server environment.',
      };
    }

    try {
      const url = `${this.apiBaseUrl}/models/${encodeURIComponent(this.model)}?key=${encodeURIComponent(this.apiKey)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        return {
          available: true,
          provider: 'Gemini',
          model: this.model,
        };
      }

      let errorDetail = `HTTP ${res.status}`;
      try {
        const body: any = await res.json();
        if (body?.error?.message) {
          errorDetail = body.error.message;
        }
      } catch {}

      if (res.status === 403) {
        return {
          available: false,
          provider: 'Gemini',
          model: this.model,
          error: `GEMINI_API_KEY is not authorized (403): ${this.sanitizeErrorMessage(errorDetail)}`,
        };
      } else if (res.status === 404) {
        return {
          available: false,
          provider: 'Gemini',
          model: this.model,
          error: `Gemini model "${this.model}" not found or unavailable (404): ${this.sanitizeErrorMessage(errorDetail)}`,
        };
      } else if (res.status === 429) {
        return {
          available: false,
          provider: 'Gemini',
          model: this.model,
          error: `Gemini rate limit / quota exceeded (429): ${this.sanitizeErrorMessage(errorDetail)}`,
        };
      } else {
        return {
          available: false,
          provider: 'Gemini',
          model: this.model,
          error: `Gemini API check failed (${res.status}): ${this.sanitizeErrorMessage(errorDetail)}`,
        };
      }
    } catch (err: any) {
      return {
        available: false,
        provider: 'Gemini',
        model: this.model,
        error: this.sanitizeErrorMessage(err.message || 'Failed to connect to Gemini API.'),
      };
    }
  }

  async generateResponse(params: GenerateResponseParams): Promise<GenerateResponseResult> {
    if (!this.isConfigured()) {
      throw new Error(
        'AI Provider is unavailable: GEMINI_API_KEY is not configured. Please configure your Gemini API key in dashboard/server environment settings.'
      );
    }

    // Separate system instructions from conversation turns
    let systemInstructionText = '';
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    for (const msg of params.messages) {
      if (msg.role === 'system') {
        systemInstructionText = systemInstructionText ? `${systemInstructionText}\n\n${msg.content}` : msg.content;
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        });
      }
    }

    // If all messages were system messages, ensure at least one user turn exists
    if (contents.length === 0) {
      contents.push({
        role: 'user',
        parts: [{ text: 'Hello' }],
      });
    }

    const payload: any = {
      contents,
      generationConfig: {
        temperature: params.temperature ?? 0.3,
        maxOutputTokens: params.maxTokens ?? 500,
      },
    };

    if (systemInstructionText) {
      payload.systemInstruction = {
        parts: [{ text: systemInstructionText }],
      };
    }

    try {
      const url = `${this.apiBaseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        let errorMsg = `HTTP ${res.status} ${res.statusText}`;
        try {
          const errBody: any = await res.json();
          if (errBody?.error?.message) {
            errorMsg = errBody.error.message;
          }
        } catch {}

        if (res.status === 403) {
          throw new Error(`Gemini authorization error (403): ${this.sanitizeErrorMessage(errorMsg)}`);
        } else if (res.status === 429) {
          throw new Error(`Gemini rate limit / quota exceeded (429): ${this.sanitizeErrorMessage(errorMsg)}`);
        } else if (res.status === 404) {
          throw new Error(`Gemini model not found (404): ${this.sanitizeErrorMessage(errorMsg)}`);
        } else {
          throw new Error(`Gemini API error (${res.status}): ${this.sanitizeErrorMessage(errorMsg)}`);
        }
      }

      const data: any = await res.json();
      const candidate = data?.candidates?.[0];
      const rawContent = candidate?.content?.parts?.[0]?.text || '';

      const usageMetadata = data?.usageMetadata;
      const promptTokens = usageMetadata?.promptTokenCount || 0;
      const completionTokens = usageMetadata?.candidatesTokenCount || 0;
      const totalTokens = usageMetadata?.totalTokenCount || (promptTokens + completionTokens);

      const estimatedCostUsd = this.calculateCost(this.model, promptTokens, completionTokens);

      const handoffRequired =
        rawContent.includes('[HUMAN_HANDOFF_REQUESTED]') ||
        rawContent.toLowerCase().includes('connect you with a human') ||
        rawContent.toLowerCase().includes('hand this conversation over to our staff');

      const cleanContent = rawContent.replace(/\[HUMAN_HANDOFF_REQUESTED\]/g, '').trim();

      return {
        content: cleanContent,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd,
        model: this.model,
        provider: 'Gemini',
        handoffRequired,
      };
    } catch (err: any) {
      console.error('[GeminiProvider] Generation failed:', this.sanitizeErrorMessage(err.message || ''));
      throw new Error(`Gemini generation error: ${this.sanitizeErrorMessage(err.message || 'Unknown error')}`);
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.isConfigured()) {
      throw new Error('AI Provider is unavailable: GEMINI_API_KEY is not configured for generating embeddings.');
    }

    try {
      const url = `${this.apiBaseUrl}/models/${encodeURIComponent(this.embeddingModel)}:embedContent?key=${encodeURIComponent(this.apiKey)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: {
            parts: [{ text: text.replace(/\n/g, ' ').substring(0, 8000) }],
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        let errDetail = `HTTP ${res.status}`;
        try {
          const body: any = await res.json();
          if (body?.error?.message) errDetail = body.error.message;
        } catch {}
        throw new Error(`Gemini embedding error (${res.status}): ${this.sanitizeErrorMessage(errDetail)}`);
      }

      const data: any = await res.json();
      if (!data?.embedding?.values || !Array.isArray(data.embedding.values)) {
        throw new Error('Malformed embedding response from Gemini API.');
      }

      return data.embedding.values;
    } catch (err: any) {
      console.error('[GeminiProvider] Embedding failed:', this.sanitizeErrorMessage(err.message || ''));
      throw new Error(`Gemini embedding error: ${this.sanitizeErrorMessage(err.message || 'Unknown error')}`);
    }
  }

  calculateCost(model: string, promptTokens: number, completionTokens: number): number {
    const modelLower = (model || this.model).toLowerCase();
    let promptRate = 0.000000075;
    let completionRate = 0.0000003;

    if (modelLower.includes('gpt-4o-mini') || modelLower.includes('gpt-3.5')) {
      promptRate = 0.00000015;
      completionRate = 0.0000006;
    } else if (modelLower.includes('gpt-4o') || modelLower.includes('gpt-4')) {
      promptRate = 0.000005;
      completionRate = 0.000015;
    } else if (modelLower.includes('gemini-1.5-pro') || modelLower.includes('gemini-2.5-pro')) {
      promptRate = 0.00000125;
      completionRate = 0.000005;
    }

    const cost = promptTokens * promptRate + completionTokens * completionRate;
    return Math.round(cost * 1000000) / 1000000;
  }

  estimateCost(model: string, promptTokens: number, completionTokens: number): number {
    return this.calculateCost(model, promptTokens, completionTokens);
  }
}

/**
 * AI Provider Factory
 * Creates an AIProvider instance based on requested provider string or system configuration.
 */
export function createAIProvider(providerName?: string): IAIProvider {
  const provider = (providerName || config.ai.provider || 'gemini').toLowerCase().trim();
  if (provider === 'openai') {
    return new OpenAIProvider();
  } else if (provider === 'gemini') {
    return new GeminiProvider();
  } else {
    throw new Error(
      `Unsupported AI Provider: "${provider}". Valid configured providers are "openai" or "gemini".`
    );
  }
}

/**
 * Delegating AI Provider instance
 * Maintains backward-compatible export `aiProvider` while delegating dynamically
 * based on environment configuration `AI_PROVIDER` and allowing test overrides.
 */
export class DelegatingAIProvider implements IAIProvider {
  private activeProvider: IAIProvider | null = null;
  private overrideProviderName: string | null = null;

  private getProvider(): IAIProvider {
    if (this.activeProvider) {
      return this.activeProvider;
    }
    const targetProvider = this.overrideProviderName || config.ai.provider || 'gemini';
    this.activeProvider = createAIProvider(targetProvider);
    return this.activeProvider;
  }

  get providerName(): string {
    return this.getProvider().providerName;
  }

  get modelName(): string {
    return this.getProvider().modelName;
  }

  async healthCheck(): Promise<{ available: boolean; provider: string; model: string; error?: string }> {
    return this.getProvider().healthCheck();
  }

  async generateResponse(params: GenerateResponseParams): Promise<GenerateResponseResult> {
    return this.getProvider().generateResponse(params);
  }

  async generateEmbedding(text: string): Promise<number[]> {
    return this.getProvider().generateEmbedding(text);
  }

  calculateCost(model: string, promptTokens: number, completionTokens: number): number {
    return this.getProvider().calculateCost(model, promptTokens, completionTokens);
  }

  estimateCost(model: string, promptTokens: number, completionTokens: number): number {
    return this.getProvider().estimateCost(model, promptTokens, completionTokens);
  }

  setProvider(provider: IAIProvider): void {
    this.activeProvider = provider;
  }

  setProviderType(providerName: string): void {
    this.overrideProviderName = providerName;
    this.activeProvider = createAIProvider(providerName);
  }

  reset(): void {
    this.activeProvider = null;
    this.overrideProviderName = null;
  }
}

// Global default provider instance
export const aiProvider: IAIProvider = new DelegatingAIProvider();
