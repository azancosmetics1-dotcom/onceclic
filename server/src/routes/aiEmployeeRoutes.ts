import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { tenantIsolationMiddleware } from '../middleware/tenantIsolationMiddleware';
import { requirePermission } from '../middleware/rbacMiddleware';
import { db } from '../db';
import { aiProvider } from '../services/AIProvider';
import { AuditService } from '../services/AuditService';
import { AuditAction, AIEmployee } from '@onceclic/shared';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationMiddleware);

// Get AI Employee configuration
router.get('/employee', requirePermission('ai:read'), async (req: Request, res: Response, next) => {
  try {
    let employee = await db.getOne<AIEmployee>(
      `SELECT id, organization_id as "organizationId", name, role_title as "roleTitle",
              description, personality, tone, instructions, business_context as "businessContext",
              greeting_message as "greetingMessage", fallback_message as "fallbackMessage",
              operating_hours as "operatingHours", appointment_rules as "appointmentRules",
              handoff_rules as "handoffRules", status, created_at as "createdAt", updated_at as "updatedAt"
       FROM ai_employees WHERE organization_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [req.organizationId]
    );

    if (!employee) {
      // Create default if not exists
      const empId = uuidv4();
      await db.execute(
        `INSERT INTO ai_employees (
           id, organization_id, name, role_title, description, personality, tone,
           instructions, greeting_message, fallback_message, status, created_at, updated_at
         ) VALUES ($1, $2, 'Luna', 'AI Receptionist', 'Answers questions and books appointments',
                   'Warm, polite, concise', 'friendly, professional',
                   'Help customers politely and suggest booking an appointment when relevant.',
                   'Hi! How can I help you today?',
                   'I do not have enough information to answer that. Let me connect you with a team member.',
                   'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [empId, req.organizationId]
      );

      employee = (await db.getOne<AIEmployee>(
        `SELECT id, organization_id as "organizationId", name, role_title as "roleTitle",
                description, personality, tone, instructions, greeting_message as "greetingMessage",
                fallback_message as "fallbackMessage", status, created_at as "createdAt"
         FROM ai_employees WHERE id = $1`,
        [empId]
      ))!;
    }

    res.json({ success: true, data: employee });
  } catch (err) {
    next(err);
  }
});

// Update AI Employee configuration
router.put('/employee', requirePermission('ai:manage'), async (req: Request, res: Response, next) => {
  try {
    const {
      name,
      roleTitle,
      description,
      personality,
      tone,
      instructions,
      businessContext,
      greetingMessage,
      fallbackMessage,
      operatingHours,
      appointmentRules,
      handoffRules,
      status,
    } = req.body;

    await db.execute(
      `UPDATE ai_employees
       SET name = COALESCE($1, name),
           role_title = COALESCE($2, role_title),
           description = COALESCE($3, description),
           personality = COALESCE($4, personality),
           tone = COALESCE($5, tone),
           instructions = COALESCE($6, instructions),
           business_context = COALESCE($7, business_context),
           greeting_message = COALESCE($8, greeting_message),
           fallback_message = COALESCE($9, fallback_message),
           operating_hours = COALESCE($10, operating_hours),
           appointment_rules = COALESCE($11, appointment_rules),
           handoff_rules = COALESCE($12, handoff_rules),
           status = COALESCE($13, status),
           updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $14`,
      [
        name,
        roleTitle,
        description,
        personality,
        tone,
        instructions,
        businessContext,
        greetingMessage,
        fallbackMessage,
        operatingHours,
        appointmentRules,
        handoffRules,
        status,
        req.organizationId,
      ]
    );

    await AuditService.log({
      organizationId: req.organizationId!,
      userId: req.user?.id,
      action: AuditAction.AI_EMPLOYEE_UPDATED,
      entityType: 'AI_EMPLOYEE',
      metadata: { name, status },
    });

    res.json({ success: true, message: 'AI Employee settings updated successfully.' });
  } catch (err) {
    next(err);
  }
});

// Provider health check
router.get('/health', async (req: Request, res: Response, next) => {
  try {
    const health = await aiProvider.healthCheck();
    res.json({ success: true, data: health });
  } catch (err) {
    next(err);
  }
});

// AI Usage and cost history
router.get('/usage', requirePermission('ai:read'), async (req: Request, res: Response, next) => {
  try {
    const usageRes = await db.query(
      `SELECT id, provider, model, prompt_tokens as "promptTokens", completion_tokens as "completionTokens",
              total_tokens as "totalTokens", estimated_cost_usd as "estimatedCostUsd", success,
              created_at as "createdAt"
       FROM ai_usage_records
       WHERE organization_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [req.organizationId]
    );

    let totalTokens = 0;
    let totalCostUsd = 0;

    for (const row of usageRes.rows) {
      totalTokens += row.totalTokens || 0;
      totalCostUsd += parseFloat(row.estimatedCostUsd || '0');
    }

    res.json({
      success: true,
      data: {
        records: usageRes.rows,
        summary: {
          totalTokens,
          totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
          totalRequests: usageRes.rowCount,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
