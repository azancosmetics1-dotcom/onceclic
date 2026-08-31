import { db } from '../db';
import { AuditAction } from '@onceclic/shared';
import { v4 as uuidv4 } from 'uuid';

export class AuditService {
  static async log(params: {
    organizationId: string;
    userId?: string;
    action: AuditAction;
    entityType: string;
    entityId?: string;
    metadata?: Record<string, any>;
    ipAddress?: string;
  }): Promise<void> {
    try {
      // Redact sensitive secrets before logging
      const safeMetadata = params.metadata ? this.sanitizeMetadata(params.metadata) : {};

      await db.execute(
        `INSERT INTO audit_logs (id, organization_id, user_id, action, entity_type, entity_id, metadata, ip_address, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
        [
          uuidv4(),
          params.organizationId,
          params.userId || null,
          params.action,
          params.entityType,
          params.entityId || null,
          JSON.stringify(safeMetadata),
          params.ipAddress || null,
        ]
      );
    } catch (err) {
      console.error('[AuditService] Failed to write audit log:', err);
    }
  }

  private static sanitizeMetadata(obj: Record<string, any>): Record<string, any> {
    const sensitiveKeys = ['password', 'password_hash', 'token', 'secret', 'apikey', 'api_key', 'authorization', 'card', 'cvv'];
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
      const lower = key.toLowerCase();
      if (sensitiveKeys.some(s => lower.includes(s))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeMetadata(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}
