/**
 * check-live-db.ts
 * Read-only inspection of the live Supabase database.
 * Reports: applied migrations, appointment table schema, constraint status.
 * Run: npx tsx scripts/check-live-db.ts
 */
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  max: 3,
  connectionTimeoutMillis: 10000,
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n=== Applied Migrations ===');
    const migs = await client.query(
      `SELECT version, applied_at FROM schema_migrations ORDER BY version`
    );
    if (migs.rowCount === 0) {
      console.log('  (schema_migrations table empty or does not exist)');
    } else {
      migs.rows.forEach((r: any) => {
        console.log(`  ✓ ${r.version}  (applied: ${new Date(r.applied_at).toISOString()})`);
      });
    }

    console.log('\n=== appointments table columns ===');
    const cols = await client.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'appointments'
      ORDER BY ordinal_position
    `);
    cols.rows.forEach((r: any) => {
      console.log(`  ${r.column_name}: ${r.data_type}${r.is_nullable === 'NO' ? ' NOT NULL' : ''}`);
    });

    console.log('\n=== Exclusion/Unique constraints on appointments ===');
    const cons = await client.query(`
      SELECT conname, contype, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'appointments'::regclass
        AND contype IN ('x', 'u', 'p')
      ORDER BY conname
    `);
    if (cons.rowCount === 0) {
      console.log('  (no exclusion or unique constraints found)');
    } else {
      cons.rows.forEach((r: any) => {
        const type = r.contype === 'x' ? 'EXCLUDE' : r.contype === 'u' ? 'UNIQUE' : 'PRIMARY KEY';
        console.log(`  [${type}] ${r.conname}: ${r.def}`);
      });
    }

    console.log('\n=== btree_gist extension ===');
    const ext = await client.query(
      `SELECT extname, extversion FROM pg_extension WHERE extname = 'btree_gist'`
    );
    if (ext.rowCount! > 0) {
      console.log(`  ✓ btree_gist installed (v${ext.rows[0].extversion})`);
    } else {
      console.log('  ✗ btree_gist NOT installed');
    }

    console.log('\n=== salon_staff / salon_services tables ===');
    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('salon_staff', 'salon_services', 'salon_staff_services',
                           'organization_voice_assistants', 'voice_phone_numbers',
                           'voice_call_records', 'voice_recording_sync_jobs')
      ORDER BY table_name
    `);
    tables.rows.forEach((r: any) => console.log(`  ✓ ${r.table_name} exists`));
    const missing = ['salon_staff', 'salon_services', 'salon_staff_services',
      'organization_voice_assistants', 'voice_phone_numbers',
      'voice_call_records', 'voice_recording_sync_jobs']
      .filter(t => !tables.rows.some((r: any) => r.table_name === t));
    missing.forEach(t => console.log(`  ✗ ${t} MISSING`));

    console.log('\n=== voice_provider value in business_settings ===');
    const vs = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='business_settings' AND column_name='industry_type'`
    );
    console.log(`  industry_type column: ${vs.rowCount! > 0 ? 'exists' : 'MISSING'}`);

    console.log('\n=== Row counts (sanity) ===');
    for (const tbl of ['organizations', 'users', 'appointments', 'subscriptions']) {
      try {
        const cnt = await client.query(`SELECT COUNT(*) AS n FROM ${tbl}`);
        console.log(`  ${tbl}: ${cnt.rows[0].n} rows`);
      } catch {
        console.log(`  ${tbl}: (error reading)`);
      }
    }

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(e => {
  console.error('DB check failed:', e.message);
  process.exit(1);
});

