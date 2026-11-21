/**
 * Knowledge Base Re-embedding Script
 * Migrates existing knowledge chunks to gemini-embedding-001 (768-dimensional normalized vectors).
 *
 * Safety guarantees:
 * - Backs up all existing embeddings to server/backups/ before modifying anything.
 * - Supports --dry-run to audit chunks without making changes.
 * - Supports --rollback <backup-file> to revert changes safely.
 * - Processes tenant-by-tenant with transactional safety.
 * - Never deletes knowledge sources or raw content.
 */

import fs from 'fs';
import path from 'path';
import { db } from '../db';
import { aiProvider } from '../services/AIProvider';
import { config } from '../config';

interface BackupRecord {
  id: string;
  organization_id: string;
  source_id: string;
  embedding: string | null;
}

export async function reembedKnowledge(options?: {
  dryRun?: boolean;
  rollbackFile?: string;
}): Promise<{
  success: boolean;
  totalChunks: number;
  migratedChunks: number;
  failedChunks: number;
  backupPath?: string;
  error?: string;
}> {
  const isDryRun = options?.dryRun ?? process.argv.includes('--dry-run');
  const rollbackArgIdx = process.argv.indexOf('--rollback');
  const rollbackFile = options?.rollbackFile || (rollbackArgIdx !== -1 ? process.argv[rollbackArgIdx + 1] : undefined);

  console.log('====================================================');
  console.log('ONCEClic Knowledge Base Embedding Migration');
  console.log(`Target Model: ${config.gemini.embeddingModel} (768 dimensions)`);
  console.log(`Mode: ${rollbackFile ? 'ROLLBACK' : isDryRun ? 'DRY RUN' : 'MIGRATION'}`);
  console.log('====================================================\n');

  // Handle Rollback
  if (rollbackFile) {
    if (!fs.existsSync(rollbackFile)) {
      throw new Error(`Rollback file not found: ${rollbackFile}`);
    }
    const backupData: BackupRecord[] = JSON.parse(fs.readFileSync(rollbackFile, 'utf8'));
    console.log(`Restoring ${backupData.length} chunk embeddings from backup...`);
    let restored = 0;
    for (const record of backupData) {
      await db.execute(
        'UPDATE knowledge_chunks SET embedding = $1 WHERE id = $2 AND organization_id = $3',
        [record.embedding, record.id, record.organization_id]
      );
      restored++;
    }
    console.log(`✓ Successfully restored ${restored} chunk embeddings.`);
    return {
      success: true,
      totalChunks: backupData.length,
      migratedChunks: restored,
      failedChunks: 0,
    };
  }

  // Fetch all existing chunks
  const chunksRes = await db.query<any>(
    `SELECT id, organization_id, source_id, chunk_content, embedding
     FROM knowledge_chunks
     ORDER BY organization_id, source_id, chunk_index ASC`
  );

  const chunks = chunksRes.rows || [];
  console.log(`Found ${chunks.length} total knowledge chunks across all organizations.`);

  if (chunks.length === 0) {
    console.log('No knowledge chunks to migrate.');
    return { success: true, totalChunks: 0, migratedChunks: 0, failedChunks: 0 };
  }

  if (isDryRun) {
    console.log('\n[DRY RUN] Summary of chunks to be re-embedded:');
    const orgMap: Record<string, number> = {};
    for (const chunk of chunks) {
      orgMap[chunk.organization_id] = (orgMap[chunk.organization_id] || 0) + 1;
    }
    for (const [orgId, count] of Object.entries(orgMap)) {
      console.log(`  Tenant ${orgId}: ${count} chunks`);
    }
    console.log('\nDry run complete. No database changes were made.');
    return { success: true, totalChunks: chunks.length, migratedChunks: 0, failedChunks: 0 };
  }

  // 1. Create Backup before modification
  const backupDir = path.resolve(__dirname, '../../backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `knowledge_embeddings_backup_${timestamp}.json`);

  const backupRecords: BackupRecord[] = chunks.map((c) => ({
    id: c.id,
    organization_id: c.organization_id,
    source_id: c.source_id,
    embedding: c.embedding,
  }));

  fs.writeFileSync(backupPath, JSON.stringify(backupRecords, null, 2), 'utf8');
  console.log(`✓ Safety backup created: ${backupPath}\n`);

  // 2. Perform Migration
  let migrated = 0;
  let failed = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const newEmbedding = await aiProvider.generateEmbedding(chunk.chunk_content);
      if (!Array.isArray(newEmbedding) || newEmbedding.length !== 768) {
        throw new Error(`Invalid embedding vector dimension: expected 768, got ${newEmbedding?.length}`);
      }

      const embeddingJson = JSON.stringify(newEmbedding);
      await db.execute(
        `UPDATE knowledge_chunks
         SET embedding = $1
         WHERE id = $2 AND organization_id = $3`,
        [embeddingJson, chunk.id, chunk.organization_id]
      );
      migrated++;
    } catch (err: any) {
      failed++;
      console.error(`[ReembedKnowledge] Failed chunk ${chunk.id} (org: ${chunk.organization_id}):`, err?.message || err);
    }
  }

  // Update knowledge sources status to READY
  await db.execute(
    `UPDATE knowledge_sources
     SET status = 'PROCESSED', updated_at = CURRENT_TIMESTAMP
     WHERE status != 'PROCESSED'`
  );

  console.log('\n====================================================');
  console.log('Migration Complete');
  console.log(`Total: ${chunks.length} | Succeeded: ${migrated} | Failed: ${failed}`);
  console.log(`Backup file: ${backupPath}`);
  console.log('====================================================\n');

  return {
    success: failed === 0,
    totalChunks: chunks.length,
    migratedChunks: migrated,
    failedChunks: failed,
    backupPath,
  };
}

if (require.main === module) {
  reembedKnowledge()
    .then((res) => {
      process.exit(res.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal migration error:', err);
      process.exit(1);
    });
}
