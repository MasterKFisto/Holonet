import { parseTemplateManifest } from '../schema.js';

/** Modern, clean template for consulting and professional services firms. */
export const professionalServicesTemplate = parseTemplateManifest({
  id: 'professional-services',
  name: 'Professional Services',
  version: '1.0.0',
  description: 'A clean, modern template for consulting and professional services firms.',
  category: 'services',
  pages: [
    {
      path: '/',
      title: 'Home',
      description: 'Trusted expertise for growing businesses.',
      blocks: [
        {
          type: 'hero',
          props: {
            headline: 'Trusted expertise for your business',
            subheadline: 'Strategy, operations, and advisory services that move the needle.',
            alignment: 'center',
            primaryButtonLabel: 'Explore our services',
            primaryButtonLink: '/services/',
          },
        },
        {
          type: 'service_cards',
          props: {
            title: 'What we do',
            items: [
              { title: 'Strategy', description: 'Clear plans grounded in your numbers.' },
              { title: 'Operations', description: 'Processes that scale with you.' },
              { title: 'Advisory', description: 'Senior guidance when it matters.' },
            ],
          },
        },
        {
          type: 'testimonials',
          props: {
            title: 'Client voices',
            quotes: [
              {
                quote: 'They delivered clarity in weeks, not quarters.',
                author: 'Founder, SaaS company',
              },
              {
                quote: 'Our operations finally run without firefighting.',
                author: 'COO, Retail group',
              },
            ],
          },
        },
        {
          type: 'cta_section',
          props: {
            headline: 'Ready to get started?',
            buttonLabel: 'Contact us',
            buttonLink: '/contact/',
          },
        },
      ],
    },
    {
      path: '/about',
      title: 'About',
      blocks: [
        {
          type: 'text_section',
          props: {
            heading: 'Who we are',
            content:
              'We are a team of experienced consultants who help organizations grow with confidence.\n\nOur approach is practical, evidence-based, and tailored to your situation.',
          },
        },
        {
          type: 'team_members',
          props: {
            title: 'Leadership',
            members: [
              { name: 'Alex Morgan', role: 'Managing Partner' },
              { name: 'Jordan Lee', role: 'Practice Lead' },
            ],
          },
        },
      ],
    },
    {
      path: '/services',
      title: 'Services',
      blocks: [
        {
          type: 'text_section',
          props: {
            heading: 'How we help',
            content: 'Every engagement starts with a clear diagnosis.',
          },
        },
        {
          type: 'service_cards',
          props: {
            title: 'Engagements',
            items: [
              { title: 'Diagnostics', description: 'Understand the real problem.' },
              { title: 'Implementation', description: 'Ship the fix with your team.' },
              { title: 'Ongoing support', description: 'Stay ahead as you scale.' },
            ],
          },
        },
        {
          type: 'faq',
          props: {
            title: 'Common questions',
            items: [
              {
                question: 'How do engagements start?',
                answer: 'With a short discovery call and a written proposal.',
              },
              {
                question: 'Do you work remotely?',
                answer: 'Yes — we work with teams across time zones.',
              },
            ],
          },
        },
      ],
    },
    {
      path: '/team',
      title: 'Team',
      blocks: [
        {
          type: 'text_section',
          props: { heading: 'Meet the team', content: 'Senior people, hands-on throughout.' },
        },
        {
          type: 'team_members',
          props: {
            title: 'Our people',
            members: [
              { name: 'Alex Morgan', role: 'Managing Partner' },
              { name: 'Jordan Lee', role: 'Practice Lead' },
              { name: 'Sam Carter', role: 'Senior Consultant' },
            ],
          },
        },
      ],
    },
    {
      path: '/contact',
      title: 'Contact',
      blocks: [
        {
          type: 'map_address',
          props: { address: '100 Market Street, Suite 300, San Francisco, CA 94105' },
        },
        {
          type: 'contact_form',
          props: { title: 'Send us a message', submitLabel: 'Send message' },
        },
        {
          type: 'text_section',
          props: { heading: 'Prefer email?', content: 'hello@example-firm.com' },
        },
      ],
    },
    {
      path: '/privacy-policy',
      title: 'Privacy Policy',
      blocks: [
        {
          type: 'text_section',
          props: {
            heading: 'Privacy Policy',
            content:
              'We collect only the information needed to provide our services.\n\nWe never sell personal data. Contact us for access, correction, or deletion requests.',
          },
        },
      ],
    },
    {
      path: '/terms-of-use',
      title: 'Terms of Use',
      blocks: [
        {
          type: 'text_section',
          props: {
            heading: 'Terms of Use',
            content:
              'By using this website you agree to these terms.\n\nContent is provided for general information only and does not constitute professional advice.',
          },
        },
      ],
    },
  ],
  theme: {
    colors: { primary: '#4f46e5', accent: '#0ea5e9', background: '#ffffff', text: '#0f172a' },
    fonts: { heading: 'Georgia, serif', body: 'system-ui, sans-serif' },
  },
  seo: {
    titleTemplate: '{title} | Professional Services Firm',
    defaultDescription: 'Strategy, operations, and advisory services for growing businesses.',
    author: 'Professional Services Firm',
  },
});
