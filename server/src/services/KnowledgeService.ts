import { db } from '../db';
import { aiProvider } from './AIProvider';
import { KnowledgeSourceType, KnowledgeSource, KnowledgeChunk, AuditAction } from '@onceclic/shared';
import { AuditService } from './AuditService';
import { v4 as uuidv4 } from 'uuid';

export class KnowledgeService {
  /**
   * Add a new knowledge source, automatically chunk it, and compute embeddings.
   */
  static async addSource(params: {
    organizationId: string;
    sourceType: KnowledgeSourceType;
    title: string;
    rawContent: string;
    userId?: string;
  }): Promise<KnowledgeSource> {
    const sourceId = uuidv4();
    const chunks = this.chunkText(params.rawContent);

    await db.execute(
      `INSERT INTO knowledge_sources (id, organization_id, source_type, title, raw_content, chunk_count, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'PROCESSED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [sourceId, params.organizationId, params.sourceType, params.title, params.rawContent, chunks.length]
    );

    // Save chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      let embeddingJson: string | null = null;

      try {
        const health = await aiProvider.healthCheck();
        if (health.available) {
          const emb = await aiProvider.generateEmbedding(chunkText);
          embeddingJson = JSON.stringify(emb);
        }
      } catch (embErr) {
        // Continue even if embedding generation fails (keyword search will still work)
        console.warn(`[KnowledgeService] Failed to generate embedding for chunk ${i}:`, embErr);
      }

      await db.execute(
        `INSERT INTO knowledge_chunks (id, organization_id, source_id, chunk_content, chunk_index, embedding, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
        [
          uuidv4(),
          params.organizationId,
          sourceId,
          chunkText,
          i,
          embeddingJson,
          JSON.stringify({ title: params.title, sourceType: params.sourceType }),
        ]
      );
    }

    await AuditService.log({
      organizationId: params.organizationId,
      userId: params.userId,
      action: AuditAction.KNOWLEDGE_CREATED,
      entityType: 'KNOWLEDGE_SOURCE',
      entityId: sourceId,
      metadata: { title: params.title, sourceType: params.sourceType, chunkCount: chunks.length },
    });

    const source = await db.getOne<KnowledgeSource>(
      `SELECT id, organization_id as "organizationId", source_type as "sourceType", title, raw_content as "rawContent",
              chunk_count as "chunkCount", status, created_at as "createdAt", updated_at as "updatedAt"
       FROM knowledge_sources WHERE id = $1`,
      [sourceId]
    );

    return source!;
  }

  /**
   * Delete a knowledge source and all its associated chunks.
   */
  static async deleteSource(organizationId: string, sourceId: string, userId?: string): Promise<boolean> {
    await db.execute(
      'DELETE FROM knowledge_chunks WHERE organization_id = $1 AND source_id = $2',
      [organizationId, sourceId]
    );
    const count = await db.execute(
      'DELETE FROM knowledge_sources WHERE organization_id = $1 AND id = $2',
      [organizationId, sourceId]
    );

    if (count > 0) {
      await AuditService.log({
        organizationId,
        userId,
        action: AuditAction.KNOWLEDGE_DELETED,
        entityType: 'KNOWLEDGE_SOURCE',
        entityId: sourceId,
      });
    }

    return count > 0;
  }

  /**
   * List all knowledge sources for an organization.
   */
  static async listSources(organizationId: string): Promise<KnowledgeSource[]> {
    const res = await db.query(
      `SELECT id, organization_id as "organizationId", source_type as "sourceType", title, raw_content as "rawContent",
              chunk_count as "chunkCount", status, created_at as "createdAt", updated_at as "updatedAt"
       FROM knowledge_sources WHERE organization_id = $1 ORDER BY created_at DESC`,
      [organizationId]
    );
    return res.rows;
  }

  /**
   * Find most relevant knowledge chunks using cosine vector similarity or keyword match.
   */
  static async retrieveRelevantChunks(
    organizationId: string,
    query: string,
    topK: number = 4
  ): Promise<Array<{ chunkContent: string; sourceTitle: string; sourceId: string; score: number }>> {
    const allChunksRes = await db.query(
      `SELECT kc.id, kc.chunk_content, kc.embedding, kc.source_id, ks.title as source_title
       FROM knowledge_chunks kc
       JOIN knowledge_sources ks ON kc.source_id = ks.id
       WHERE kc.organization_id = $1`,
      [organizationId]
    );

    const chunks = allChunksRes.rows;
    if (chunks.length === 0) return [];

    let queryEmbedding: number[] | null = null;
    try {
      const health = await aiProvider.healthCheck();
      if (health.available) {
        queryEmbedding = await aiProvider.generateEmbedding(query);
      }
    } catch {
      queryEmbedding = null;
    }

    const scoredChunks: Array<{ chunkContent: string; sourceTitle: string; sourceId: string; score: number }> = [];

    const queryTokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

    for (const chunk of chunks) {
      let score = 0;

      if (queryEmbedding && chunk.embedding) {
        try {
          const emb = typeof chunk.embedding === 'string' ? JSON.parse(chunk.embedding) : chunk.embedding;
          score = this.cosineSimilarity(queryEmbedding, emb);
        } catch {
          score = 0;
        }
      }

      // Keyword boost
      const contentLower = (chunk.chunk_content || '').toLowerCase();
      let keywordHits = 0;
      for (const tok of queryTokens) {
        if (contentLower.includes(tok)) keywordHits++;
      }
      const keywordScore = queryTokens.length > 0 ? keywordHits / queryTokens.length : 0;

      // Combined score
      const finalScore = queryEmbedding ? score * 0.7 + keywordScore * 0.3 : keywordScore;

      if (finalScore > 0.1 || !queryEmbedding) {
        scoredChunks.push({
          chunkContent: chunk.chunk_content,
          sourceTitle: chunk.source_title,
          sourceId: chunk.source_id,
          score: finalScore,
        });
      }
    }

    scoredChunks.sort((a, b) => b.score - a.score);
    return scoredChunks.slice(0, topK);
  }

  /**
   * Split text into overlapping chunks.
   */
  private static chunkText(text: string, maxChunkSize: number = 600, overlap: number = 100): string[] {
    const cleanText = text.trim();
    if (cleanText.length <= maxChunkSize) return [cleanText];

    const paragraphs = cleanText.split(/\n\s*\n/);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const para of paragraphs) {
      if ((currentChunk + '\n\n' + para).length <= maxChunkSize) {
        currentChunk = currentChunk ? currentChunk + '\n\n' + para : para;
      } else {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = para;
      }
    }

    if (currentChunk) chunks.push(currentChunk);
    return chunks;
  }

  /**
   * Cosine similarity between two float vectors.
   */
  private static cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
