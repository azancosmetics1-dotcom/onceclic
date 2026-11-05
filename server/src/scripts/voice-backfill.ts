import dotenv from 'dotenv';
dotenv.config();

import { db } from '../db';
import { VoiceBackfillService, BackfillDryRunReport, BackfillExecutionMetrics } from '../services/voice/VoiceBackfillService';

interface CliArgs {
  isExecute: boolean;
  isDryRun: boolean;
  rawArgs: string[];
}

function parseArgs(args: string[]): CliArgs {
  const isExecute = args.includes('--execute');
  const isDryRun = args.includes('--dry-run') || !isExecute;
  return { isExecute, isDryRun, rawArgs: args };
}

function formatTable(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((header, idx) => {
    let max = header.length;
    for (const row of rows) {
      if (row[idx] && row[idx].length > max) {
        max = row[idx].length;
      }
    }
    return max;
  });

  const sep = '+-' + colWidths.map(w => '-'.repeat(w)).join('-+-') + '-+';
  const formatRow = (cols: string[]) =>
    '| ' + cols.map((col, idx) => (col || '').padEnd(colWidths[idx])).join(' | ') + ' |';

  const output: string[] = [];
  output.push(sep);
  output.push(formatRow(headers));
  output.push(sep);
  for (const row of rows) {
    output.push(formatRow(row));
  }
  output.push(sep);
  return output.join('\n');
}

/**
 * Accurately determines if a connection URL points to a local database.
 * Uses strict URL parsing on the hostname only, ensuring remote databases
 * with "localhost" in credentials, path, or parameters are never falsely classified as local.
 */
export function isLocalDatabaseUrl(dbUrl: string | undefined): boolean {
  if (!dbUrl || typeof dbUrl !== 'string' || dbUrl.trim() === '') {
    return false; // Fail closed if missing or empty
  }

  try {
    const parsed = new URL(dbUrl);
    let host = parsed.hostname.toLowerCase().trim();

    // Normalize IPv6 bracket notation e.g. [::1]
    if (host.startsWith('[') && host.endsWith(']')) {
      host = host.slice(1, -1).trim();
    }

    // Exact match on parsed hostname only
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
  } catch {
    // Malformed URL: fail closed
    return false;
  }
}

export async function runVoiceBackfillCli(customArgs?: string[]): Promise<void> {
  const { isExecute, isDryRun, rawArgs } = parseArgs(customArgs || process.argv.slice(2));

  // Safeguard: Refuse to execute mutations on non-local / remote DB without explicit confirmation
  const isEmbedded = process.env.USE_EMBEDDED_DB === 'true';
  const dbUrl = process.env.DATABASE_URL || '';
  const isLocalDb = isEmbedded || isLocalDatabaseUrl(dbUrl);
  const hasLiveConfirmation = rawArgs.includes('--confirm-live-execution') || process.env.CONFIRM_LIVE_EXECUTION === 'true';

  if (isExecute && !isLocalDb && !hasLiveConfirmation) {
    const errorMsg = 'SAFETY BLOCK: Executing mutations against a non-local / remote database requires explicit confirmation. Pass "--confirm-live-execution" or set CONFIRM_LIVE_EXECUTION=true to proceed.';
    console.error(`\n❌ ${errorMsg}\n`);
    throw new Error(errorMsg);
  }

  console.log('========================================================================');
  console.log('  ONCEClic Voice — Assistant & Phone Line Backfill Utility');
  console.log(`  MODE: ${isExecute ? 'EXECUTE (MUTATION IN TRANSACTION)' : 'DRY-RUN (READ-ONLY SIMULATION)'}`);
  console.log(`  DATABASE: ${process.env.USE_EMBEDDED_DB === 'true' ? 'Embedded In-Memory DB' : 'PostgreSQL'}`);
  console.log('========================================================================\n');

  try {
    if (isDryRun) {
      console.log('Running dry-run simulation across all organizations...\n');
      const report: BackfillDryRunReport = await VoiceBackfillService.dryRun(db);

      const headers = [
        'Org ID',
        'Org Name',
        'Current Org Asst',
        'Current Status',
        'Lines',
        'Line Asst IDs',
        'Proposed Action',
      ];

      const rows = report.items.map(item => [
        item.organizationId.substring(0, 16),
        item.organizationName.substring(0, 20),
        item.currentOrgAssistantId || 'NULL',
        item.currentOrgStatus || 'NONE',
        `${item.linesWithAssistant}/${item.totalLines}`,
        item.lineAssistantIds.length > 0 ? item.lineAssistantIds.join(',') : 'NONE',
        item.proposedAction,
      ]);

      if (rows.length > 0) {
        console.log(formatTable(headers, rows));
      } else {
        console.log('No organizations found in database.');
      }

      console.log('\n--- DRY-RUN SUMMARY REPORT ---');
      console.log(`Total Organizations Evaluated:                  ${report.summary.totalProcessed}`);
      console.log(`Proposed: Backfill to READY:                    ${report.summary.backfillToReady}`);
      console.log(`Proposed: Flag Reconciliation (Divergent):      ${report.summary.flagReconciliationRequiredDivergent}`);
      console.log(`Proposed: Flag Reconciliation (Mismatch):       ${report.summary.flagReconciliationRequiredMismatch}`);
      console.log(`Proposed: Initialize IDLE:                      ${report.summary.initializeIdle}`);
      console.log(`Proposed: No-Op (Active Lease Claim):           ${report.summary.noOpActiveClaim}`);
      console.log(`Proposed: No-Op (Already Flagged):              ${report.summary.noOpAlreadyFlagged}`);
      console.log(`Proposed: No-Op (Already Consistent):           ${report.summary.noOpAlreadyConsistent}`);
      console.log(`Proposed: No-Op (Pre-existing READY No Lines):  ${report.summary.noOpPreexistingReady}`);
      console.log('------------------------------');
      console.log('NOTE: Dry-run completed with 0 mutations. Use --execute to apply changes atomically.\n');
    } else {
      console.log('Executing backfill atomically inside a single transaction...');
      const metrics: BackfillExecutionMetrics = await db.withTransaction(async (tx) => {
        return await VoiceBackfillService.executeBackfill(tx);
      });

      console.log('\n========================================================================');
      console.log('  BACKFILL EXECUTION COMPLETED SUCCESSFULLY');
      console.log('========================================================================');
      console.log(`Total Organizations Processed:          ${metrics.totalOrganizations}`);
      console.log(`Organizations Backfilled to READY:      ${metrics.backfilledToReady}`);
      console.log(`Organizations Flagged for Reconcile:    ${metrics.flaggedReconciliationRequired}`);
      console.log(`Organizations Initialized to IDLE:      ${metrics.initializedIdle}`);
      console.log(`Unchanged Organizations (No-Op):        ${metrics.noOpUnchanged}`);
      console.log(`Phone Lines Marked SYNCHRONIZED:        ${metrics.linesSynchronized}`);
      console.log(`Phone Lines Marked PENDING:             ${metrics.linesPending}`);
      console.log(`Total Preserved Phone Lines:            ${metrics.preservedLinesCount}`);
      console.log('========================================================================\n');
    }
  } catch (error: any) {
    console.error('\n❌ BACKFILL PROCESS FAILED (TRANSACTION ROLLED BACK SAFELY):');
    console.error(error?.message || error);
    if (error?.stack) {
      console.error(error.stack);
    }
    process.exitCode = 1;
    throw error;
  }
}

// Allow execution when run directly as CLI
const isMain = require.main === module || (process.argv[1] && /[\\/]voice-backfill(\.ts|\.js)?$/i.test(process.argv[1]));
if (isMain) {
  runVoiceBackfillCli().catch(() => {
    process.exit(1);
  });
}
