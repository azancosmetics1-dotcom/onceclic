import { config } from '../config';
import { AuditService } from './AuditService';
import { AuditAction } from '@onceclic/shared';

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export interface EmailDispatchResult {
  success: boolean;
  id?: string;
  error?: string;
  isSimulated?: boolean;
}

export class ResendEmailService {
  private static RESEND_API_URL = 'https://api.resend.com/emails';

  /**
   * Primary dispatcher to Resend transactional email API.
   */
  static async sendEmail(options: SendEmailOptions): Promise<EmailDispatchResult> {
    const from = options.from || config.resend.fromEmail;
    const recipients = Array.isArray(options.to) ? options.to : [options.to];

    // If Resend API Key is not configured (e.g. CI / local test environment), simulate safely
    if (!config.resend.isConfigured) {
      const mockId = `sim_resend_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      console.log(`[Resend Simulated] To: ${recipients.join(', ')} | Subject: "${options.subject}" | ID: ${mockId}`);
      return {
        success: true,
        id: mockId,
        isSimulated: true,
      };
    }

    try {
      const payload: Record<string, any> = {
        from,
        to: recipients,
        subject: options.subject,
        html: options.html,
      };

      if (options.text) {
        payload.text = options.text;
      }

      const res = await fetch(this.RESEND_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.resend.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as any;

      if (!res.ok) {
        const errorMsg = data?.message || data?.error || `HTTP ${res.status} from Resend API`;
        console.error('[Resend Error]', errorMsg);
        return {
          success: false,
          error: errorMsg,
        };
      }

      return {
        success: true,
        id: data.id,
        isSimulated: false,
      };
    } catch (err: any) {
      console.error('[Resend Exception]', err.message || err);
      return {
        success: false,
        error: err.message || 'Failed to dispatch email via Resend API',
      };
    }
  }

  /**
   * Send Email Verification Link on Registration or Resend.
   */
  static async sendVerificationEmail(params: {
    toEmail: string;
    token: string;
    fullName?: string;
    organizationId?: string;
    userId?: string;
  }): Promise<EmailDispatchResult> {
    const frontendUrl = config.frontendUrl || config.app.url;
    const verifyUrl = `${frontendUrl}/verify-email?token=${encodeURIComponent(params.token)}`;
    const name = params.fullName || 'there';

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your ONCEClic account</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #020617; color: #f8fafc;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 40px auto; background-color: #0f172a; border-radius: 16px; border: 1px solid #1e293b; overflow: hidden;">
    <tr>
      <td style="padding: 36px 40px; text-align: center; border-bottom: 1px solid #1e293b; background: linear-gradient(180deg, #0f172a 0%, #020617 100%);">
        <h1 style="margin: 0; font-size: 26px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">
          ONCE<span style="color: #10b981;">Clic</span>
        </h1>
        <p style="margin: 6px 0 0; font-size: 13px; color: #94a3b8; letter-spacing: 0.5px; text-transform: uppercase;">
          AI Receptionist for Modern Businesses
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding: 40px 40px 30px;">
        <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #ffffff;">
          Verify your email address
        </h2>
        <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #cbd5e1;">
          Hi ${name},<br><br>
          Thank you for creating an account on ONCEClic. Please click the button below to verify your email address and activate your workspace.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${verifyUrl}" style="display: inline-block; background-color: #10b981; color: #ffffff; font-weight: 600; font-size: 15px; text-decoration: none; padding: 14px 32px; border-radius: 10px; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);">
            Verify My Email
          </a>
        </div>
        <p style="margin: 28px 0 0; font-size: 13px; line-height: 1.5; color: #64748b;">
          This link will expire in 24 hours. If you did not create an account on ONCEClic, you can safely ignore this email.
        </p>
        <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid #1e293b;">
          <p style="margin: 0; font-size: 12px; color: #64748b; word-break: break-all;">
            Button not working? Copy and paste this link in your browser:<br>
            <a href="${verifyUrl}" style="color: #10b981; text-decoration: underline;">${verifyUrl}</a>
          </p>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding: 24px 40px; background-color: #020617; border-top: 1px solid #1e293b; text-align: center;">
        <p style="margin: 0; font-size: 12px; color: #475569;">
          &copy; ${new Date().getFullYear()} ONCEClic. All rights reserved. &bull; <a href="${config.app.url}" style="color: #64748b; text-decoration: none;">onceclic.com</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();

    const text = `Hi ${name},\n\nPlease verify your email address for ONCEClic by visiting:\n${verifyUrl}\n\nThis link will expire in 24 hours.\n\n- The ONCEClic Team`;

    const result = await this.sendEmail({
      to: params.toEmail,
      subject: 'Verify your ONCEClic account',
      html,
      text,
    });

    if (params.organizationId && params.userId) {
      await AuditService.log({
        organizationId: params.organizationId,
        userId: params.userId,
        action: AuditAction.EMAIL_VERIFICATION_SENT,
        entityType: 'USER',
        entityId: params.userId,
        metadata: { to: params.toEmail, dispatchResult: result.id || 'simulated' },
      });
    }

    return result;
  }

  /**
   * Send Customer Booking Confirmation Email.
   */
  static async sendBookingConfirmation(params: {
    appointmentId: string;
    customerName: string;
    customerEmail: string;
    serviceName: string;
    businessName: string;
    startTime: string; // ISO
    endTime: string;   // ISO
    timezone?: string;
    notes?: string;
    organizationId: string;
  }): Promise<EmailDispatchResult> {
    const tz = params.timezone || 'UTC';
    const startDate = new Date(params.startTime);
    const dateFormatted = startDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: tz,
    });
    const timeFormatted = startDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    });

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Appointment Confirmed - ${params.businessName}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #020617; color: #f8fafc;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 40px auto; background-color: #0f172a; border-radius: 16px; border: 1px solid #1e293b; overflow: hidden;">
    <tr>
      <td style="padding: 32px 40px; text-align: center; border-bottom: 1px solid #1e293b; background: linear-gradient(180deg, #0f172a 0%, #020617 100%);">
        <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff;">
          ${params.businessName}
        </h1>
        <p style="margin: 6px 0 0; font-size: 13px; color: #10b981; font-weight: 600; text-transform: uppercase;">
          ✓ Appointment Confirmed
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding: 36px 40px;">
        <h2 style="margin: 0 0 16px; font-size: 18px; color: #ffffff;">
          Hi ${params.customerName},
        </h2>
        <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #cbd5e1;">
          Your appointment has been successfully scheduled. Here are the details:
        </p>
        <table width="100%" cellpadding="12" cellspacing="0" style="background-color: #020617; border-radius: 12px; border: 1px solid #1e293b; margin-bottom: 24px;">
          <tr>
            <td style="color: #94a3b8; font-size: 14px; width: 35%;">Service:</td>
            <td style="color: #ffffff; font-size: 14px; font-weight: 600;">${params.serviceName}</td>
          </tr>
          <tr>
            <td style="color: #94a3b8; font-size: 14px; border-top: 1px solid #1e293b;">Date:</td>
            <td style="color: #ffffff; font-size: 14px; font-weight: 600; border-top: 1px solid #1e293b;">${dateFormatted}</td>
          </tr>
          <tr>
            <td style="color: #94a3b8; font-size: 14px; border-top: 1px solid #1e293b;">Time:</td>
            <td style="color: #10b981; font-size: 14px; font-weight: 600; border-top: 1px solid #1e293b;">${timeFormatted} (${tz})</td>
          </tr>
          <tr>
            <td style="color: #94a3b8; font-size: 14px; border-top: 1px solid #1e293b;">Reference:</td>
            <td style="color: #64748b; font-size: 12px; font-family: monospace; border-top: 1px solid #1e293b;">${params.appointmentId}</td>
          </tr>
        </table>
        <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #64748b;">
          If you need to reschedule or cancel your appointment, please contact us at least 24 hours prior.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding: 20px 40px; background-color: #020617; border-top: 1px solid #1e293b; text-align: center;">
        <p style="margin: 0; font-size: 12px; color: #475569;">
          Powered by <a href="https://onceclic.com" style="color: #10b981; text-decoration: none;">ONCEClic AI Receptionist</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();

    const text = `Hi ${params.customerName},\n\nYour appointment for ${params.serviceName} at ${params.businessName} is confirmed for ${dateFormatted} at ${timeFormatted} (${tz}).\n\nBooking ID: ${params.appointmentId}`;

    const result = await this.sendEmail({
      to: params.customerEmail,
      subject: `Appointment Confirmed: ${params.serviceName} - ${dateFormatted}`,
      html,
      text,
    });

    await AuditService.log({
      organizationId: params.organizationId,
      action: AuditAction.BOOKING_CONFIRMATION_EMAIL_SENT,
      entityType: 'APPOINTMENT',
      entityId: params.appointmentId,
      metadata: { to: params.customerEmail, dispatchResult: result.id || 'simulated' },
    });

    return result;
  }

  /**
   * Send Customer Booking Cancellation Email.
   */
  static async sendBookingCancellation(params: {
    appointmentId: string;
    customerName: string;
    customerEmail: string;
    serviceName: string;
    businessName: string;
    startTime: string;
    organizationId: string;
  }): Promise<EmailDispatchResult> {
    const startDate = new Date(params.startTime);
    const dateFormatted = startDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const html = `
<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 0; font-family: sans-serif; background-color: #020617; color: #f8fafc;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 40px auto; background-color: #0f172a; border-radius: 16px; border: 1px solid #1e293b; padding: 32px 40px;">
    <tr>
      <td>
        <h2 style="color: #ef4444; margin-top: 0;">Appointment Cancelled</h2>
        <p style="color: #cbd5e1; font-size: 15px;">
          Hi ${params.customerName},<br><br>
          Your appointment for <strong>${params.serviceName}</strong> on <strong>${dateFormatted}</strong> at ${params.businessName} has been cancelled.
        </p>
        <p style="color: #64748b; font-size: 13px;">
          Reference ID: ${params.appointmentId}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();

    const result = await this.sendEmail({
      to: params.customerEmail,
      subject: `Appointment Cancelled: ${params.serviceName} - ${params.businessName}`,
      html,
      text: `Hi ${params.customerName},\n\nYour appointment for ${params.serviceName} on ${dateFormatted} has been cancelled.\nReference: ${params.appointmentId}`,
    });

    await AuditService.log({
      organizationId: params.organizationId,
      action: AuditAction.BOOKING_CANCELLATION_EMAIL_SENT,
      entityType: 'APPOINTMENT',
      entityId: params.appointmentId,
      metadata: { to: params.customerEmail },
    });

    return result;
  }

  /**
   * Send Customer Booking Rescheduled Email.
   */
  static async sendBookingRescheduled(params: {
    appointmentId: string;
    customerName: string;
    customerEmail: string;
    serviceName: string;
    businessName: string;
    newStartTime: string;
    newEndTime: string;
    timezone?: string;
    organizationId: string;
  }): Promise<EmailDispatchResult> {
    const tz = params.timezone || 'UTC';
    const startDate = new Date(params.newStartTime);
    const dateFormatted = startDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: tz,
    });
    const timeFormatted = startDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    });

    const html = `
<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 0; font-family: sans-serif; background-color: #020617; color: #f8fafc;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 40px auto; background-color: #0f172a; border-radius: 16px; border: 1px solid #1e293b; padding: 32px 40px;">
    <tr>
      <td>
        <h2 style="color: #38bdf8; margin-top: 0;">Appointment Rescheduled</h2>
        <p style="color: #cbd5e1; font-size: 15px;">
          Hi ${params.customerName},<br><br>
          Your appointment for <strong>${params.serviceName}</strong> at ${params.businessName} has been rescheduled to:
        </p>
        <div style="background-color: #020617; border-radius: 10px; padding: 16px; margin: 20px 0; border: 1px solid #1e293b;">
          <p style="margin: 0; color: #ffffff; font-size: 16px; font-weight: 600;">
            ${dateFormatted} at ${timeFormatted} (${tz})
          </p>
        </div>
        <p style="color: #64748b; font-size: 13px;">
          Reference ID: ${params.appointmentId}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();

    const result = await this.sendEmail({
      to: params.customerEmail,
      subject: `Appointment Rescheduled: ${params.serviceName} - ${params.businessName}`,
      html,
      text: `Hi ${params.customerName},\n\nYour appointment for ${params.serviceName} has been rescheduled to ${dateFormatted} at ${timeFormatted} (${tz}).\nReference: ${params.appointmentId}`,
    });

    await AuditService.log({
      organizationId: params.organizationId,
      action: AuditAction.BOOKING_RESCHEDULED_EMAIL_SENT,
      entityType: 'APPOINTMENT',
      entityId: params.appointmentId,
      metadata: { to: params.customerEmail, newTime: params.newStartTime },
    });

    return result;
  }
}
