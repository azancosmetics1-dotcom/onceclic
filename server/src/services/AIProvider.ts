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
  healthCheck(): Promise<{ available: boolean; provider: string; model: string; error?: string }>;
  generateResponse(params: GenerateResponseParams): Promise<GenerateResponseResult>;
  generateEmbedding(text: string): Promise<number[]>;
  calculateCost(model: string, promptTokens: number, completionTokens: number): number;
}

export class OpenAIProvider implements IAIProvider {
  private client: OpenAI | null = null;
  private chatModel: string;
  private embeddingModel: string;

  constructor() {
    this.chatModel = config.openai.chatModel;
    this.embeddingModel = config.openai.embeddingModel;
    if (config.openai.apiKey && !config.openai.apiKey.includes('placeholder')) {
      this.client = new OpenAI({ apiKey: config.openai.apiKey, maxRetries: 1 });
    }
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
      // Light model check
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

      // Check if response contains an explicit handoff flag or marker
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
    // Current OpenAI rates: gpt-4o-mini = $0.15 / 1M prompt, $0.60 / 1M completion
    // gpt-4o = $5.00 / 1M prompt, $15.00 / 1M completion
    let promptRate = 0.00000015;
    let completionRate = 0.0000006;

    if (model.includes('gpt-4o') && !model.includes('mini')) {
      promptRate = 0.000005;
      completionRate = 0.000015;
    }

    const cost = promptTokens * promptRate + completionTokens * completionRate;
    return Math.round(cost * 1000000) / 1000000;
  }
}

// Factory instance
export const aiProvider: IAIProvider = new OpenAIProvider();
