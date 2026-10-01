import {
  BusinessDataCompletenessReport,
  BusinessFieldStatus,
  ServiceItem,
  DayBusinessHours,
  RestaurantReservationSettings,
} from '@onceclic/shared';
import { db } from '../db';
import { config } from '../config';

export class BusinessDataCompletenessService {
  /**
   * Evaluate business-data completeness for an organization.
   * Distinguishes required vs optional fields and configured vs missing status.
   * Optional missing fields do NOT block AI readiness.
   */
  static evaluateCompleteness(params: {
    org: any;
    settings?: any;
    aiEmployee?: any;
    knowledgeCount?: number;
  }): BusinessDataCompletenessReport {
    const { org, settings, aiEmployee, knowledgeCount = 0 } = params;
    const organizationId = org?.id || '';
    const businessName = org?.name || '';
    const industry = org?.business_type || 'services';
    const industryLower = industry.toLowerCase();

    const fields: BusinessFieldStatus[] = [];

    // ----------------------------------------------------
    // 1. GENERAL FIELDS
    // ----------------------------------------------------
    // Business Name (Required)
    const hasName = !!businessName && businessName.trim().length > 0;
    fields.push({
      field: 'business_name',
      category: 'general',
      tier: 'required',
      status: hasName ? 'configured' : 'missing',
      valueSummary: hasName ? businessName : undefined,
      notes: hasName ? 'Verified business name' : 'Missing business name',
    });

    // Industry / Business Type (Required)
    const hasIndustry = !!industry && industry.trim().length > 0;
    fields.push({
      field: 'industry',
      category: 'general',
      tier: 'required',
      status: hasIndustry ? 'configured' : 'missing',
      valueSummary: hasIndustry ? industry : undefined,
      notes: hasIndustry ? `Industry classified as ${industry}` : 'Missing industry type',
    });

    // Public Booking URL (Required)
    const bookingUrl = `${config.app.url}/book/${org?.slug || org?.id || organizationId}`;
    fields.push({
      field: 'booking_url',
      category: 'general',
      tier: 'required',
      status: 'configured',
      valueSummary: bookingUrl,
      notes: 'Direct customer reservation/booking link',
    });

    // Physical Address / Location (Optional)
    const address = org?.address?.trim();
    const hasAddress = !!address && address.length > 0;
    fields.push({
      field: 'address',
      category: 'general',
      tier: 'optional',
      status: hasAddress ? 'configured' : 'missing',
      valueSummary: hasAddress ? address : undefined,
      notes: hasAddress ? 'Physical location configured' : 'No physical address configured (strictly grounded)',
    });

    // Phone (Optional)
    const phone = org?.phone?.trim();
    const hasPhone = !!phone && phone.length > 0;
    fields.push({
      field: 'phone',
      category: 'general',
      tier: 'optional',
      status: hasPhone ? 'configured' : 'missing',
      valueSummary: hasPhone ? phone : undefined,
    });

    // Email (Optional)
    const email = org?.email?.trim();
    const hasEmail = !!email && email.length > 0;
    fields.push({
      field: 'email',
      category: 'general',
      tier: 'optional',
      status: hasEmail ? 'configured' : 'missing',
      valueSummary: hasEmail ? email : undefined,
    });

    // Website (Optional)
    const website = org?.website?.trim();
    const hasWebsite = !!website && website.length > 0;
    fields.push({
      field: 'website',
      category: 'general',
      tier: 'optional',
      status: hasWebsite ? 'configured' : 'missing',
      valueSummary: hasWebsite ? website : undefined,
    });

    // Business Description / Instructions (Optional)
    const instructions = aiEmployee?.instructions?.trim() || aiEmployee?.businessContext?.trim();
    const hasInstructions = !!instructions && instructions.length > 0;
    fields.push({
      field: 'business_description',
      category: 'general',
      tier: 'optional',
      status: hasInstructions ? 'configured' : 'missing',
      valueSummary: hasInstructions ? `${instructions.substring(0, 50)}...` : undefined,
    });

    // Cancellation Policy (Optional)
    const cancellationPolicy = settings?.cancellation_policy?.trim();
    const hasCancellation = !!cancellationPolicy && cancellationPolicy.length > 0;
    fields.push({
      field: 'cancellation_policy',
      category: 'general',
      tier: 'optional',
      status: hasCancellation ? 'configured' : 'missing',
      valueSummary: hasCancellation ? cancellationPolicy : undefined,
    });

    // Contact Instructions (Optional)
    const contactInstructions = settings?.contact_instructions?.trim();
    const hasContactInstructions = !!contactInstructions && contactInstructions.length > 0;
    fields.push({
      field: 'contact_instructions',
      category: 'general',
      tier: 'optional',
      status: hasContactInstructions ? 'configured' : 'missing',
      valueSummary: hasContactInstructions ? contactInstructions : undefined,
    });

    // Business Hours (Optional)
    let parsedHours: DayBusinessHours[] = [];
    if (settings?.business_hours) {
      try {
        parsedHours =
          typeof settings.business_hours === 'string'
            ? JSON.parse(settings.business_hours)
            : settings.business_hours;
      } catch {}
    }
    const hasHours = Array.isArray(parsedHours) && parsedHours.length > 0;
    fields.push({
      field: 'business_hours',
      category: 'general',
      tier: 'optional',
      status: hasHours ? 'configured' : 'missing',
      valueSummary: hasHours ? `${parsedHours.length} days defined` : undefined,
      notes: hasHours ? 'Operating schedule defined' : 'No operating hours defined (AI must not guess)',
    });

    // Knowledge Base Grounding (Optional)
    fields.push({
      field: 'knowledge_base',
      category: 'general',
      tier: 'optional',
      status: knowledgeCount > 0 ? 'configured' : 'missing',
      valueSummary: knowledgeCount > 0 ? `${knowledgeCount} grounded source(s)` : undefined,
    });

    // ----------------------------------------------------
    // 2. SERVICES & MENU ITEMS
    // ----------------------------------------------------
    let parsedServices: ServiceItem[] = [];
    if (settings?.services) {
      try {
        parsedServices =
          typeof settings.services === 'string'
            ? JSON.parse(settings.services)
            : settings.services;
      } catch {}
    }
    const hasServices = Array.isArray(parsedServices) && parsedServices.length > 0;
    fields.push({
      field: 'services_catalog',
      category: 'services',
      tier: 'optional',
      status: hasServices ? 'configured' : 'missing',
      valueSummary: hasServices ? `${parsedServices.length} service(s) configured` : undefined,
      notes: hasServices
        ? parsedServices.map((s) => `${s.name}${s.price !== undefined ? ` ($${s.price})` : ''}`).join(', ')
        : 'No services catalog configured (AI must refuse unknown services)',
    });

    // ----------------------------------------------------
    // 3. INDUSTRY-SPECIFIC FIELDS
    // ----------------------------------------------------
    const isClinic =
      industryLower.includes('clinic') ||
      industryLower.includes('dental') ||
      industryLower.includes('doctor') ||
      industryLower.includes('health') ||
      industryLower.includes('medical');

    const isRestaurant =
      industryLower.includes('restaurant') ||
      industryLower.includes('cafe') ||
      industryLower.includes('food') ||
      industryLower.includes('dining') ||
      industryLower.includes('bar');

    const isSalon =
      industryLower.includes('salon') ||
      industryLower.includes('spa') ||
      industryLower.includes('beauty') ||
      industryLower.includes('hair') ||
      industryLower.includes('barber');

    if (isClinic) {
      fields.push({
        field: 'clinic_information',
        category: 'clinic',
        tier: 'required',
        status: hasName ? 'configured' : 'missing',
        valueSummary: businessName,
      });
      fields.push({
        field: 'clinic_services_and_prices',
        category: 'clinic',
        tier: 'optional',
        status: hasServices ? 'configured' : 'missing',
        valueSummary: hasServices ? `${parsedServices.length} clinic services` : undefined,
      });
      fields.push({
        field: 'clinic_appointment_rules',
        category: 'clinic',
        tier: 'optional',
        status: hasCancellation ? 'configured' : 'missing',
        valueSummary: cancellationPolicy,
      });
      fields.push({
        field: 'clinic_location',
        category: 'clinic',
        tier: 'optional',
        status: hasAddress ? 'configured' : 'missing',
        valueSummary: address,
      });
    } else if (isRestaurant) {
      let parsedRes: RestaurantReservationSettings | null = null;
      if (settings?.reservation_settings) {
        try {
          parsedRes =
            typeof settings.reservation_settings === 'string'
              ? JSON.parse(settings.reservation_settings)
              : settings.reservation_settings;
        } catch {}
      }

      const hasPricingType = !!parsedRes?.pricingType;
      const hasPartyLimits = !!(parsedRes?.maxPartySize || parsedRes?.minPartySize);
      const hasDeposit =
        (parsedRes?.pricingType === 'deposit' && parsedRes.depositAmount !== undefined) ||
        (parsedRes?.pricingType === 'reservation_fee' && parsedRes.feeAmount !== undefined) ||
        (parsedRes?.pricingType === 'minimum_spend' && parsedRes.minimumSpendAmount !== undefined);

      fields.push({
        field: 'restaurant_information',
        category: 'restaurant',
        tier: 'required',
        status: hasName ? 'configured' : 'missing',
        valueSummary: businessName,
      });
      fields.push({
        field: 'reservation_rules',
        category: 'restaurant',
        tier: 'optional',
        status: hasPricingType ? 'configured' : 'missing',
        valueSummary: parsedRes?.pricingType ? `Pricing: ${parsedRes.pricingType}` : undefined,
      });
      fields.push({
        field: 'party_size_limits',
        category: 'restaurant',
        tier: 'optional',
        status: hasPartyLimits ? 'configured' : 'missing',
        valueSummary: hasPartyLimits ? `Max: ${parsedRes?.maxPartySize || 'any'}, Min: ${parsedRes?.minPartySize || 1}` : undefined,
      });
      fields.push({
        field: 'reservation_deposit_or_fee',
        category: 'restaurant',
        tier: 'optional',
        status: hasDeposit ? 'configured' : 'missing',
        valueSummary: hasDeposit
          ? parsedRes?.pricingType === 'deposit'
            ? `$${parsedRes.depositAmount} deposit`
            : parsedRes?.pricingType === 'reservation_fee'
            ? `$${parsedRes.feeAmount} fee`
            : `$${parsedRes?.minimumSpendAmount} min spend`
          : 'None / Free reservations',
      });
      fields.push({
        field: 'restaurant_special_instructions',
        category: 'restaurant',
        tier: 'optional',
        status: parsedRes?.specialInstructions ? 'configured' : 'missing',
        valueSummary: parsedRes?.specialInstructions,
      });
    } else if (isSalon) {
      fields.push({
        field: 'salon_information',
        category: 'salon',
        tier: 'required',
        status: hasName ? 'configured' : 'missing',
        valueSummary: businessName,
      });
      fields.push({
        field: 'salon_services_and_prices',
        category: 'salon',
        tier: 'optional',
        status: hasServices ? 'configured' : 'missing',
        valueSummary: hasServices ? `${parsedServices.length} salon treatments` : undefined,
      });
      fields.push({
        field: 'salon_opening_hours',
        category: 'salon',
        tier: 'optional',
        status: hasHours ? 'configured' : 'missing',
        valueSummary: hasHours ? `${parsedHours.length} days defined` : undefined,
      });
      fields.push({
        field: 'salon_location',
        category: 'salon',
        tier: 'optional',
        status: hasAddress ? 'configured' : 'missing',
        valueSummary: address,
      });
    }

    // ----------------------------------------------------
    // COMPUTED TOTALS & READINESS
    // ----------------------------------------------------
    const totalFields = fields.length;
    const configuredCount = fields.filter((f) => f.status === 'configured').length;
    const missingCount = fields.filter((f) => f.status === 'missing').length;
    const requiredMissingCount = fields.filter((f) => f.tier === 'required' && f.status === 'missing').length;

    // Organization is ready for AI if all required fields are present
    const isReadyForAI = requiredMissingCount === 0;
    const scorePercent = totalFields > 0 ? Math.round((configuredCount / totalFields) * 100) : 0;

    return {
      organizationId,
      businessName,
      industry,
      isReadyForAI,
      scorePercent,
      fields,
      summary: {
        totalFields,
        configuredCount,
        missingCount,
        requiredMissingCount,
      },
    };
  }

  /**
   * Fetch completeness report directly by querying the database for an organization.
   */
  static async getCompletenessReport(organizationId: string): Promise<BusinessDataCompletenessReport> {
    const org = await db.getOne(
      'SELECT id, name, slug, business_type, phone, email, website, address, timezone FROM organizations WHERE id = $1',
      [organizationId]
    );

    if (!org) {
      throw new Error(`Organization ${organizationId} not found.`);
    }

    const settings = await db.getOne(
      'SELECT business_hours, services, cancellation_policy, contact_instructions, reservation_settings FROM business_settings WHERE organization_id = $1',
      [organizationId]
    );

    const aiEmployee = await db.getOne(
      "SELECT name, role_title, description, personality, tone, instructions, business_context FROM ai_employees WHERE organization_id = $1 AND status = 'ACTIVE' LIMIT 1",
      [organizationId]
    );

    const knowledgeRes = await db.query(
      'SELECT COUNT(id) as count FROM knowledge_sources WHERE organization_id = $1',
      [organizationId]
    );
    const knowledgeCount = parseInt(knowledgeRes.rows[0]?.count || '0', 10);

    return this.evaluateCompleteness({
      org,
      settings,
      aiEmployee,
      knowledgeCount,
    });
  }

  /**
   * Render structured, un-guessable grounding directives for AI system prompts.
   * Explicitly separates what is configured from what is absent.
   */
  static formatGroundingContext(params: {
    org: any;
    settings?: any;
    aiEmployee?: any;
  }): string {
    const { org, settings, aiEmployee } = params;
    const report = this.evaluateCompleteness(params);

    const address = org?.address?.trim();
    const phone = org?.phone?.trim();
    const email = org?.email?.trim();
    const website = org?.website?.trim();
    const bookingUrl = `${config.app.url}/book/${org?.slug || org?.id || org?.id}`;

    // Parse Services
    let services: ServiceItem[] = [];
    if (settings?.services) {
      try {
        services =
          typeof settings.services === 'string'
            ? JSON.parse(settings.services)
            : settings.services;
      } catch {}
    }

    let servicesBlock = '';
    if (Array.isArray(services) && services.length > 0) {
      servicesBlock = services
        .map((s, idx) => {
          const priceStr = s.price !== undefined && s.price !== null ? `$${s.price}` : 'Price upon request';
          const durationStr = s.durationMinutes ? `${s.durationMinutes} mins` : 'Flexible duration';
          const descStr = s.description ? ` - ${s.description}` : '';
          return `  ${idx + 1}. ${s.name}: ${priceStr} (${durationStr})${descStr}`;
        })
        .join('\n');
    } else {
      servicesBlock = '  No specific services or prices are configured yet in the business catalog.';
    }

    // Parse Business Hours
    let hours: DayBusinessHours[] = [];
    if (settings?.business_hours) {
      try {
        hours =
          typeof settings.business_hours === 'string'
            ? JSON.parse(settings.business_hours)
            : settings.business_hours;
      } catch {}
    }

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let hoursBlock = '';
    if (Array.isArray(hours) && hours.length > 0) {
      hoursBlock = hours
        .map((h) => {
          const dayName = dayNames[h.dayOfWeek] || `Day ${h.dayOfWeek}`;
          if (h.isClosed) return `  - ${dayName}: Closed`;
          return `  - ${dayName}: ${h.openTime || '09:00'} - ${h.closeTime || '17:00'}`;
        })
        .join('\n');
    } else {
      hoursBlock = '  Operating hours are not listed online. Direct customers to contact the business.';
    }

    // Parse Restaurant Reservation Settings
    let reservationBlock = '';
    if (settings?.reservation_settings) {
      try {
        const resSettings: RestaurantReservationSettings =
          typeof settings.reservation_settings === 'string'
            ? JSON.parse(settings.reservation_settings)
            : settings.reservation_settings;

        const parts: string[] = [];
        if (resSettings.pricingType === 'deposit' && resSettings.depositAmount) {
          parts.push(`Deposit required: $${resSettings.depositAmount}`);
        } else if (resSettings.pricingType === 'reservation_fee' && resSettings.feeAmount) {
          parts.push(`Reservation fee: $${resSettings.feeAmount}`);
        } else if (resSettings.pricingType === 'minimum_spend' && resSettings.minimumSpendAmount) {
          parts.push(`Minimum spend: $${resSettings.minimumSpendAmount} per party`);
        } else {
          parts.push('Reservations are complimentary (no deposit or reservation fee required)');
        }

        if (resSettings.maxPartySize) {
          parts.push(`Max party size: ${resSettings.maxPartySize}`);
        }
        if (resSettings.minPartySize) {
          parts.push(`Min party size: ${resSettings.minPartySize}`);
        }
        if (resSettings.specialInstructions) {
          parts.push(`Instructions: ${resSettings.specialInstructions}`);
        }
        reservationBlock = parts.map((p) => `  - ${p}`).join('\n');
      } catch {}
    }

    return `VERIFIED BUSINESS DATA (GROUND TRUTH):
- Business Name: ${org?.name || 'Our Business'}
- Industry: ${org?.business_type || 'Services'}
- Public Booking URL: ${bookingUrl}
- Physical Address: ${address || 'NOT CONFIGURED / NOT LISTED ONLINE'}
- Contact Phone: ${phone || 'NOT CONFIGURED'}
- Contact Email: ${email || 'NOT CONFIGURED'}
- Website: ${website || 'NOT CONFIGURED'}
- Timezone: ${org?.timezone || 'UTC'}
- Cancellation Policy: ${settings?.cancellation_policy || 'Standard 24-hour cancellation notice'}
- Contact Instructions: ${settings?.contact_instructions || 'Please contact our team directly for further assistance.'}

CONFIGURED SERVICES & PRICING:
${servicesBlock}

CONFIGURED OPERATING HOURS:
${hoursBlock}
${
  reservationBlock
    ? `\nCONFIGURED RESERVATION SETTINGS:\n${reservationBlock}`
    : ''
}

BUSINESS DATA COMPLETENESS SUMMARY:
- Data Quality Score: ${report.scorePercent}%
- Configured Fields: ${report.summary.configuredCount}/${report.summary.totalFields}
- Ready For AI: ${report.isReadyForAI ? 'YES' : 'NO'}`;
  }
}
