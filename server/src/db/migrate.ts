import { getDatabase } from './index';

export async function runMigrations() {
  const db = getDatabase();
  console.log('[Migration] Starting database migration...');
  await db.runMigrations();
  console.log('[Migration] Database migration completed.');
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Migration Error]', err);
      process.exit(1);
    });
}
