/**
 * ONCEClic Public Knowledge Grounding Service
 * Provides comprehensive, verified grounding for Google Gemini AI on all public pages,
 * features, pricing, policies, integrations, and booking workflows.
 */

export interface PublicKnowledgeItem {
  category: string;
  topic: string;
  url: string;
  summary: string;
  keyPoints: string[];
}

export class PublicKnowledgeGroundingService {
  private static publicKnowledge: PublicKnowledgeItem[] = [
    {
      category: 'Overview & Platform',
      topic: 'What is ONCEClic?',
      url: 'https://onceclic.com',
      summary:
        'ONCEClic is an all-in-one AI Receptionist designed for small businesses (clinics, salons, restaurants, and professional service providers) to automate customer communication, inquiry answering, and appointment bookings 24/7.',
      keyPoints: [
        'Works across 24/7 Website Chat, Gmail/Email, Google Calendar, Instagram DMs, and Facebook Page Messages.',
        'Prevents double-booking with real-time slot synchronization.',
        'Easy 1-line script website embed or standalone direct booking links.',
        'Seamless human handoff with instant business owner alerts.',
      ],
    },
    {
      category: 'Pricing & Trial',
      topic: 'ONCEClic Pro Plan & 7-Day Free Trial',
      url: 'https://onceclic.com/pricing',
      summary:
        'ONCEClic offers a single, transparent Pro subscription at $19/month USD with a 7-day free trial requiring no credit card upfront.',
      keyPoints: [
        'Price: $19 USD / month for ONCEClic Pro.',
        'Free Trial: 7 days free with $0 upfront cost.',
        'No Credit Card Required to start the 7-day trial.',
        'No automatic trial charges when the trial expires.',
        'Merchant of Record: Paddle processes all subscription payments securely.',
        'Cancel anytime directly from the billing dashboard with zero hidden penalties.',
      ],
    },
    {
      category: 'Integrations & Channels',
      topic: 'Multi-Channel AI Receptionist Capabilities',
      url: 'https://onceclic.com/about',
      summary:
        'ONCEClic provides seamless multi-channel reception capabilities powered by Composio and Google Gemini AI.',
      keyPoints: [
        'Website Chatbot: Embeddable responsive widget that answers customer inquiries and books appointments.',
        'Gmail & Business Email: Automatically drafts and sends grounded replies to customer emails.',
        'Google Calendar: Real-time availability check, slot booking, and conflict prevention.',
        'Instagram DM Receptionist: 24/7 customer engagement and direct booking links via Instagram Direct.',
        'Facebook Messenger: Instant customer inquiry answering and reservation links on Facebook Pages.',
      ],
    },
    {
      category: 'Appointment & Table Booking',
      topic: 'Real-Time Booking & Reservation Engine',
      url: 'https://onceclic.com/book',
      summary:
        'Customers can book appointments or reserve tables directly through conversational AI or the public booking page.',
      keyPoints: [
        'Real-time double-booking prevention engine.',
        'Industry-tailored workflows: Clinic (patients & consultations), Salon (services & stylists), Restaurant (party size, tables & deposits).',
        'Automatic customer confirmation emails and instant business owner notification alerts via Resend.',
      ],
    },
    {
      category: 'Billing & Merchant of Record',
      topic: 'Paddle Billing & Security',
      url: 'https://onceclic.com/terms',
      summary:
        'Paddle acts as Merchant of Record for all paid transactions, managing tax compliance, global invoicing, and fraud prevention.',
      keyPoints: [
        'All paid checkouts are securely hosted and verified via Paddle Live.',
        'Supports major global credit cards, debit cards, PayPal, and localized payment methods.',
        'Customer portal allows customers to update payment methods or download VAT/tax invoices anytime.',
      ],
    },
    {
      category: 'Refund Policy',
      topic: '14-Day Refund Guarantee',
      url: 'https://onceclic.com/refund',
      summary:
        'ONCEClic provides a customer-friendly 14-day refund policy for paid subscriptions processed through Paddle.',
      keyPoints: [
        '14-day refund window from the date of initial subscription payment.',
        'Refund requests can be submitted to support@onceclic.com or through Paddle billing support.',
      ],
    },
    {
      category: 'Privacy & Security',
      topic: 'Data Privacy & Tenant Isolation',
      url: 'https://onceclic.com/privacy',
      summary:
        'ONCEClic enforces strict multi-tenant isolation, enterprise encryption, and zero cross-tenant data sharing.',
      keyPoints: [
        'Tenant data is strictly isolated and never mixed between different business accounts.',
        'OAuth tokens and credentials are encrypted at rest using AES-256-GCM.',
        'Strict anti-prompt injection and data grounding guardrails protect business data.',
      ],
    },
    {
      category: 'Support & Contact',
      topic: 'Customer Support & Help Desk',
      url: 'https://onceclic.com/contact',
      summary:
        'ONCEClic customer support is available to assist business owners with onboarding, integrations, and billing inquiries.',
      keyPoints: [
        'Official Support Email: support@onceclic.com',
        'Support response time: within 24 hours on business days.',
        'Self-service Knowledge Base and documentation available in the dashboard.',
      ],
    },
  ];

  /**
   * Retrieve all public knowledge items.
   */
  static getAllKnowledge(): PublicKnowledgeItem[] {
    return this.publicKnowledge;
  }

  /**
   * Format comprehensive public knowledge grounding for AI prompt injection.
   */
  static getGroundingContext(userQuery: string = ''): string {
    const q = userQuery.toLowerCase();
    const isOnceclicQuery =
      q.includes('onceclic') ||
      q.includes('price') ||
      q.includes('pricing') ||
      q.includes('trial') ||
      q.includes('free') ||
      q.includes('paddle') ||
      q.includes('refund') ||
      q.includes('cancel') ||
      q.includes('support') ||
      q.includes('about') ||
      q.includes('features') ||
      q.includes('what is') ||
      q.includes('how does');

    const items = this.publicKnowledge;

    const formatted = items
      .map(
        (item) => `[ONCEClic Public Knowledge: ${item.topic} | URL: ${item.url}]
Summary: ${item.summary}
Key Facts:
${item.keyPoints.map((p) => `- ${p}`).join('\n')}`
      )
      .join('\n\n');

    return `VERIFIED ONCECLIC PUBLIC PLATFORM & PAGE KNOWLEDGE:
${formatted}`;
  }
}
