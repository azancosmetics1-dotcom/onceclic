import { Pool, PoolClient } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export interface DBResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface IDatabase {
  query<T = any>(sql: string, params?: any[]): Promise<DBResult<T>>;
  getOne<T = any>(sql: string, params?: any[]): Promise<T | null>;
  execute(sql: string, params?: any[]): Promise<number>;
  withTransaction<T>(callback: (client: IDatabase) => Promise<T>): Promise<T>;
  runMigrations(): Promise<void>;
  close(): Promise<void>;
}

// PostgreSQL Implementation
class PostgresDatabase implements IDatabase {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      ssl: connectionString.includes('supabase') || process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<DBResult<T>> {
    const start = Date.now();
    const res = await this.pool.query(sql, params);
    const duration = Date.now() - start;
    if (process.env.DEBUG_SQL === 'true') {
      console.log('Executed query', { sql, duration, rows: res.rowCount });
    }
    return {
      rows: res.rows as T[],
      rowCount: res.rowCount || 0,
    };
  }

  async getOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const result = await this.query<T>(sql, params);
    return result.rows[0] || null;
  }

  async execute(sql: string, params: any[] = []): Promise<number> {
    const result = await this.query(sql, params);
    return result.rowCount;
  }

  async withTransaction<T>(callback: (tx: IDatabase) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txDb: IDatabase = {
        query: async <R = any>(sql: string, params: any[] = []): Promise<DBResult<R>> => {
          const res = await client.query(sql, params);
          return { rows: res.rows as R[], rowCount: res.rowCount || 0 };
        },
        getOne: async <R = any>(sql: string, params: any[] = []): Promise<R | null> => {
          const res = await client.query(sql, params);
          return (res.rows[0] as R) || null;
        },
        execute: async (sql: string, params: any[] = []): Promise<number> => {
          const res = await client.query(sql, params);
          return res.rowCount || 0;
        },
        withTransaction: () => {
          throw new Error('Nested transactions not supported');
        },
        runMigrations: async () => {},
        close: async () => {},
      };

      const result = await callback(txDb);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async runMigrations(): Promise<void> {
    const possibleDirs = [
      path.join(__dirname, 'migrations'),
      path.join(__dirname, '..', '..', 'src', 'db', 'migrations'),
      path.join(process.cwd(), 'server', 'src', 'db', 'migrations'),
      path.join(process.cwd(), 'src', 'db', 'migrations'),
    ];

    let migrationsDir = '';
    for (const dir of possibleDirs) {
      if (fs.existsSync(dir)) {
        migrationsDir = dir;
        break;
      }
    }

    if (!migrationsDir) {
      console.log('[Postgres] No migrations directory found. Skipping migration run.');
      return;
    }

    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      console.log(`[Postgres] Running migration: ${file}`);
      await this.pool.query(sql);
    }
    console.log('[Postgres] All migrations applied successfully.');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Embedded In-Memory SQL / Storage Implementation for Local Zero-Config & Tests
class EmbeddedDatabase implements IDatabase {
  private tables: Map<string, Map<string, any>> = new Map();
  private initialized = false;

  constructor() {
    this.initTables();
  }

  private initTables() {
    const tableNames = [
      'users',
      'organizations',
      'organization_memberships',
      'subscriptions',
      'ai_employees',
      'business_settings',
      'knowledge_sources',
      'knowledge_chunks',
      'availability_rules',
      'appointments',
      'conversations',
      'conversation_messages',
      'email_connections',
      'calendar_connections',
      'audit_logs',
      'ai_usage_records',
      'sessions',
      'password_resets',
      'email_verifications',
      'processed_webhook_events',
      'oauth_states',
    ];
    for (const t of tableNames) {
      if (!this.tables.has(t)) {
        this.tables.set(t, new Map());
      }
    }
    this.initialized = true;
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<DBResult<T>> {
    // Normalization and table identification
    const trimmed = sql.trim();
    const cleanSql = trimmed.replace(/\s+/g, ' ');

    // 1. SELECT queries
    if (/^SELECT/i.test(cleanSql)) {
      return this.handleSelect<T>(cleanSql, params);
    }

    // 2. INSERT queries
    if (/^INSERT INTO/i.test(cleanSql)) {
      return this.handleInsert<T>(cleanSql, params);
    }

    // 3. UPDATE queries
    if (/^UPDATE/i.test(cleanSql)) {
      return this.handleUpdate<T>(cleanSql, params);
    }

    // 4. DELETE queries
    if (/^DELETE FROM/i.test(cleanSql)) {
      return this.handleDelete<T>(cleanSql, params);
    }

    return { rows: [], rowCount: 0 };
  }

  async getOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const result = await this.query<T>(sql, params);
    return result.rows[0] || null;
  }

  async execute(sql: string, params: any[] = []): Promise<number> {
    const res = await this.query(sql, params);
    return res.rowCount;
  }

  async withTransaction<T>(callback: (client: IDatabase) => Promise<T>): Promise<T> {
    // In-memory atomic callback
    return await callback(this);
  }

  async runMigrations(): Promise<void> {
    this.initTables();
    console.log('[Embedded DB] Initialized in-memory multi-tenant schema.');
  }

  async close(): Promise<void> {
    this.tables.clear();
  }

  // Helper implementations for in-memory relational operations
  private handleSelect<T>(sql: string, params: any[]): DBResult<T> {
    const fromMatch = sql.match(/FROM\s+([a-zA-Z0-9_]+)/i);
    if (!fromMatch) return { rows: [], rowCount: 0 };
    const table = fromMatch[1].toLowerCase();
    const tableData = this.tables.get(table);
    if (!tableData) return { rows: [], rowCount: 0 };

    let rows = Array.from(tableData.values());

    // Basic WHERE filter parser
    if (/WHERE/i.test(sql)) {
      rows = rows.filter(row => this.evaluateWhere(sql, row, params));
    }

    // ORDER BY
    const orderMatch = sql.match(/ORDER BY\s+([a-zA-Z0-9_.]+)\s*(ASC|DESC)?/i);
    if (orderMatch) {
      let col = orderMatch[1].toLowerCase();
      if (col.includes('.')) col = col.split('.')[1];
      const isDesc = (orderMatch[2] || '').toUpperCase() === 'DESC';
      rows.sort((a, b) => {
        const valA = a[col];
        const valB = b[col];
        if (valA === valB) return 0;
        if (valA == null) return isDesc ? 1 : -1;
        if (valB == null) return isDesc ? -1 : 1;
        const comp = valA > valB ? 1 : -1;
        return isDesc ? -comp : comp;
      });
    }

    // LIMIT
    const limitMatch = sql.match(/LIMIT\s+(\$?\d+)/i);
    if (limitMatch) {
      let limitVal = 100;
      if (limitMatch[1].startsWith('$')) {
        const pIdx = parseInt(limitMatch[1].substring(1), 10) - 1;
        limitVal = parseInt(params[pIdx], 10);
      } else {
        limitVal = parseInt(limitMatch[1], 10);
      }
      rows = rows.slice(0, limitVal);
    }

    // Parse SELECT columns and aliases (e.g. col as "alias")
    const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
    if (selectMatch && selectMatch[1].trim() !== '*') {
      const colDefs = selectMatch[1].split(',').map(c => c.trim());
      const projectedRows = rows.map(r => {
        const projected: any = {};
        colDefs.forEach(def => {
          const aliasMatch = def.match(/(?:[a-zA-Z0-9_.]+\.)?([a-zA-Z0-9_]+)\s+AS\s+["']?([a-zA-Z0-9_]+)["']?/i);
          if (aliasMatch) {
            const rawCol = aliasMatch[1].toLowerCase();
            const alias = aliasMatch[2];
            projected[alias] = r[rawCol] !== undefined ? r[rawCol] : null;
            projected[rawCol] = r[rawCol] !== undefined ? r[rawCol] : null;
          } else {
            let rawCol = def.replace(/^[a-zA-Z0-9_.]+\./, '').trim().toLowerCase();
            projected[rawCol] = r[rawCol] !== undefined ? r[rawCol] : null;
          }
        });
        // Preserve common camelCase variants
        if (r.client_message_id !== undefined) projected.clientMessageId = r.client_message_id;
        if (r.organization_id !== undefined) projected.organizationId = r.organization_id;
        if (r.conversation_id !== undefined) projected.conversationId = r.conversation_id;
        if (r.customer_name !== undefined) projected.customerName = r.customer_name;
        if (r.customer_email !== undefined) projected.customerEmail = r.customer_email;
        if (r.customer_phone !== undefined) projected.customerPhone = r.customer_phone;
        if (r.created_at !== undefined) projected.createdAt = r.created_at;
        if (r.updated_at !== undefined) projected.updatedAt = r.updated_at;
        return projected;
      });
      return { rows: projectedRows as T[], rowCount: projectedRows.length };
    }

    return { rows: rows as T[], rowCount: rows.length };
  }

  private handleInsert<T>(sql: string, params: any[]): DBResult<T> {
    const match = sql.match(/INSERT INTO\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    if (!match) return { rows: [], rowCount: 0 };

    const table = match[1].toLowerCase();
    const columns = match[2].split(',').map(c => c.trim().toLowerCase());
    const valExpressions = match[3].split(',').map(v => v.trim());
    const tableData = this.tables.get(table);
    if (!tableData) return { rows: [], rowCount: 0 };

    const row: any = {};
    columns.forEach((col, idx) => {
      const valExpr = valExpressions[idx];
      if (!valExpr) {
        row[col] = params[idx] !== undefined ? params[idx] : null;
      } else if (valExpr.startsWith('$')) {
        const pIdx = parseInt(valExpr.substring(1), 10) - 1;
        row[col] = params[pIdx] !== undefined ? params[pIdx] : null;
      } else if (valExpr.toUpperCase() === 'CURRENT_TIMESTAMP' || valExpr.toUpperCase() === 'NOW()') {
        row[col] = new Date().toISOString();
      } else if (valExpr.toUpperCase() === 'TRUE') {
        row[col] = true;
      } else if (valExpr.toUpperCase() === 'FALSE') {
        row[col] = false;
      } else if (valExpr.toUpperCase() === 'NULL') {
        row[col] = null;
      } else if (/^\d+(\.\d+)?$/.test(valExpr)) {
        row[col] = Number(valExpr);
      } else {
        row[col] = valExpr.replace(/^'|'$/g, '');
      }
    });

    if (!row.id) {
      row.id = `id_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
    if (!row.created_at) row.created_at = new Date().toISOString();
    if (!row.updated_at) row.updated_at = new Date().toISOString();

    // Check unique constraints
    if (table === 'users' && row.email) {
      for (const existing of tableData.values()) {
        if (existing.email === row.email) {
          throw new Error(`duplicate key value violates unique constraint "users_email_key"`);
        }
      }
    }
    if (table === 'organizations' && row.slug) {
      for (const existing of tableData.values()) {
        if (existing.slug === row.slug) {
          throw new Error(`duplicate key value violates unique constraint "organizations_slug_key"`);
        }
      }
    }
    if (table === 'organization_memberships' && row.organization_id && row.user_id) {
      for (const existing of tableData.values()) {
        if (existing.organization_id === row.organization_id && existing.user_id === row.user_id) {
          throw new Error(`duplicate key value violates unique constraint "uq_org_user"`);
        }
      }
    }
    if (table === 'conversation_messages' && row.conversation_id && row.client_message_id) {
      for (const existing of tableData.values()) {
        if (existing.conversation_id === row.conversation_id && existing.client_message_id === row.client_message_id) {
          // Idempotency: return existing row without duplicating
          return { rows: [existing] as T[], rowCount: 1 };
        }
      }
    }

    tableData.set(row.id, row);
    return { rows: [row] as T[], rowCount: 1 };
  }

  private handleUpdate<T>(sql: string, params: any[]): DBResult<T> {
    const tableMatch = sql.match(/UPDATE\s+([a-zA-Z0-9_]+)/i);
    if (!tableMatch) return { rows: [], rowCount: 0 };
    const table = tableMatch[1].toLowerCase();
    const tableData = this.tables.get(table);
    if (!tableData) return { rows: [], rowCount: 0 };

    const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/i);
    if (!setMatch) return { rows: [], rowCount: 0 };

    const setClauses = setMatch[1].split(',').map(s => s.trim());
    let updatedCount = 0;
    const updatedRows: any[] = [];

    for (const [id, row] of tableData.entries()) {
      if (this.evaluateWhere(sql, row, params)) {
        setClauses.forEach(clause => {
          const parts = clause.split('=');
          const col = parts[0].trim().toLowerCase();
          const valPlaceholder = parts[1].trim();
          if (valPlaceholder.startsWith('$')) {
            const pIdx = parseInt(valPlaceholder.substring(1), 10) - 1;
            row[col] = params[pIdx];
          } else if (valPlaceholder.toUpperCase() === 'CURRENT_TIMESTAMP' || valPlaceholder.toUpperCase() === 'NOW()') {
            row[col] = new Date().toISOString();
          } else if (valPlaceholder.toUpperCase() === 'TRUE') {
            row[col] = true;
          } else if (valPlaceholder.toUpperCase() === 'FALSE') {
            row[col] = false;
          } else {
            row[col] = valPlaceholder.replace(/'/g, '');
          }
        });
        row.updated_at = new Date().toISOString();
        updatedRows.push(row);
        updatedCount++;
      }
    }

    return { rows: updatedRows as T[], rowCount: updatedCount };
  }

  private handleDelete<T>(sql: string, params: any[]): DBResult<T> {
    const tableMatch = sql.match(/DELETE FROM\s+([a-zA-Z0-9_]+)/i);
    if (!tableMatch) return { rows: [], rowCount: 0 };
    const table = tableMatch[1].toLowerCase();
    const tableData = this.tables.get(table);
    if (!tableData) return { rows: [], rowCount: 0 };

    let deletedCount = 0;
    for (const [id, row] of Array.from(tableData.entries())) {
      if (this.evaluateWhere(sql, row, params)) {
        tableData.delete(id);
        deletedCount++;
      }
    }
    return { rows: [], rowCount: deletedCount };
  }

  private evaluateWhere(sql: string, row: any, params: any[]): boolean {
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER BY|\s+LIMIT|\s+GROUP BY|$)/i);
    if (!whereMatch) return true;

    const whereClause = whereMatch[1];
    // Split by AND
    const conditions = whereClause.split(/\s+AND\s+/i);

    for (const cond of conditions) {
      // Check IN condition e.g. status IN ('CONFIRMED', 'REQUESTED')
      const inMatch = cond.match(/([a-zA-Z0-9_.]+)\s+IN\s*\(([^)]+)\)/i);
      if (inMatch) {
        let col = inMatch[1].trim().toLowerCase();
        if (col.includes('.')) col = col.split('.')[1];
        const allowedValues = inMatch[2].split(',').map(v => v.trim().replace(/'/g, ''));
        const rowVal = String(row[col] || '');
        if (!allowedValues.includes(rowVal)) return false;
        continue;
      }

      const eqMatch = cond.match(/([a-zA-Z0-9_.]+)\s*(=|!=|<>|LIKE|ILIKE|>=|<=|>|<|IS)\s*(.+)/i);
      if (!eqMatch) continue;

      let col = eqMatch[1].trim().toLowerCase();
      if (col.includes('.')) col = col.split('.')[1];
      const op = eqMatch[2].trim().toUpperCase();
      let targetValStr = eqMatch[3].trim();

      let targetVal: any;
      if (targetValStr.startsWith('$')) {
        const pIdx = parseInt(targetValStr.substring(1), 10) - 1;
        targetVal = params[pIdx];
      } else if (targetValStr === 'NULL') {
        targetVal = null;
      } else if (targetValStr === 'TRUE') {
        targetVal = true;
      } else if (targetValStr === 'FALSE') {
        targetVal = false;
      } else if (/^\d+(\.\d+)?$/.test(targetValStr)) {
        targetVal = Number(targetValStr);
      } else {
        targetVal = targetValStr.replace(/'/g, '');
      }

      const rowVal = row[col];

      if (op === '=') {
        if (rowVal != targetVal) return false;
      } else if (op === '!=' || op === '<>') {
        if (rowVal == targetVal) return false;
      } else if (op === 'IS') {
        if (targetVal === null && rowVal !== null && rowVal !== undefined) return false;
      } else if (op === 'LIKE' || op === 'ILIKE') {
        const pattern = String(targetVal).replace(/%/g, '.*');
        const regex = new RegExp(pattern, op === 'ILIKE' ? 'i' : '');
        if (!regex.test(String(rowVal || ''))) return false;
      } else if (op === '>=') {
        if (rowVal < targetVal) return false;
      } else if (op === '<=') {
        if (rowVal > targetVal) return false;
      } else if (op === '>') {
        if (rowVal <= targetVal) return false;
      } else if (op === '<') {
        if (rowVal >= targetVal) return false;
      }
    }

    return true;
  }
}

// Database Singleton Factory
let dbInstance: IDatabase | null = null;

export function getDatabase(): IDatabase {
  if (!dbInstance) {
    const dbUrl = process.env.DATABASE_URL;
    const isProduction = process.env.NODE_ENV === 'production';

    const hasRealPassword =
      dbUrl &&
      !dbUrl.includes('placeholder') &&
      !dbUrl.includes('[YOUR-PASSWORD]') &&
      !dbUrl.includes('[password]') &&
      !dbUrl.includes('yourdbpassword') &&
      !dbUrl.includes(':yourpassword@');

    if (hasRealPassword && dbUrl) {
      const sanitizedUrl = dbUrl.replace(/\/\/[^@]+@/, '//***:***@');
      console.log(`[DB] Database: PostgreSQL/Supabase (${sanitizedUrl})`);
      dbInstance = new PostgresDatabase(dbUrl);
    } else {
      if (isProduction) {
        throw new Error(
          '[DB] FATAL ERROR: DATABASE_URL is required in production mode. Embedded in-memory database cannot be used in production.'
        );
      }
      console.log('[DB] Database: Embedded In-Memory (Development/Test Mode only)');
      dbInstance = new EmbeddedDatabase();
    }
  }
  return dbInstance;
}

export const db = getDatabase();
