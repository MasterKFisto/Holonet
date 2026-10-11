import { parseTemplateManifest } from '../schema.js';

/** Precise, numbers-first template for accounting firms. */
export const accountingFirmTemplate = parseTemplateManifest({
  id: 'accounting-firm',
  name: 'Accounting Firm',
  version: '1.0.0',
  description: 'A precise, numbers-first template for accounting firms.',
  category: 'accounting',
  pages: [
    {
      path: '/',
      title: 'Home',
      description: 'Clarity for your books, confidence for your decisions.',
      blocks: [
        {
          type: 'hero',
          props: {
            headline: 'Numbers you can trust',
            subheadline: 'Bookkeeping, tax, and CFO services for growing companies.',
            alignment: 'left',
            primaryButtonLabel: 'See our services',
            primaryButtonLink: '/services/',
          },
        },
        {
          type: 'service_cards',
          props: {
            title: 'Core services',
            items: [
              { title: 'Bookkeeping', description: 'Accurate monthly close, every month.' },
              { title: 'Tax preparation', description: 'Filing done right and on time.' },
              { title: 'CFO services', description: 'Forward-looking financial leadership.' },
            ],
          },
        },
        {
          type: 'testimonials',
          props: {
            title: 'Client voices',
            quotes: [
              {
                quote: 'Our monthly close went from three weeks to three days.',
                author: 'CEO, Software company',
              },
            ],
          },
        },
        {
          type: 'cta_section',
          props: {
            headline: 'Get a free books review',
            buttonLabel: 'Book a call',
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
            heading: 'About the firm',
            content:
              'We are certified accountants who believe great books are the foundation of every good business decision.',
          },
        },
      ],
    },
    {
      path: '/services',
      title: 'Services',
      blocks: [
        {
          type: 'service_cards',
          props: {
            title: 'What we offer',
            items: [
              { title: 'Bookkeeping', description: 'Monthly close and reconciliations.' },
              {
                title: 'Tax preparation',
                description: 'Individuals, partnerships, and corporations.',
              },
              { title: 'Payroll', description: 'Compliance without the busywork.' },
              { title: 'CFO services', description: 'Budgets, forecasts, and board decks.' },
            ],
          },
        },
        {
          type: 'faq',
          props: {
            title: 'Common questions',
            items: [
              {
                question: 'Which accounting software do you support?',
                answer: 'QuickBooks, Xero, and most major platforms.',
              },
              {
                question: 'Do you work with startups?',
                answer: 'Yes — many of our clients are early-stage companies.',
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
          type: 'team_members',
          props: {
            title: 'Our accountants',
            members: [
              { name: 'Rebecca Stone', role: 'Partner, CPA' },
              { name: 'Tom Alvarez', role: 'Senior Accountant' },
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
          props: { address: '50 Wacker Drive, Suite 800, Chicago, IL 60601' },
        },
        {
          type: 'contact_form',
          props: { title: 'Request a consultation', submitLabel: 'Submit' },
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
              'Financial information is handled with bank-grade confidentiality.\n\nWe do not share client data with third parties except as required by law.',
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
              'Content on this website is informational and does not constitute tax or accounting advice.',
          },
        },
      ],
    },
  ],
  theme: {
    colors: { primary: '#0f766e', accent: '#ca8a04', background: '#f8fafc', text: '#0f172a' },
    fonts: { heading: 'system-ui, sans-serif', body: 'system-ui, sans-serif' },
  },
  seo: {
    titleTemplate: '{title} | Stone & Alvarez Accounting',
    defaultDescription: 'Bookkeeping, tax, and CFO services for growing companies.',
    author: 'Stone & Alvarez Accounting',
  },
});
