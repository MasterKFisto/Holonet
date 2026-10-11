import { parseTemplateManifest } from '../schema.js';

/** Traditional, trust-focused template for law firms. */
export const lawFirmTemplate = parseTemplateManifest({
  id: 'law-firm',
  name: 'Law Firm',
  version: '1.0.0',
  description: 'A traditional, trust-focused template for law firms.',
  category: 'legal',
  pages: [
    {
      path: '/',
      title: 'Home',
      description: 'Experienced legal counsel for individuals and businesses.',
      blocks: [
        {
          type: 'hero',
          props: {
            headline: 'Counsel you can rely on',
            subheadline: 'Decades of experience across litigation, corporate, and family law.',
            alignment: 'left',
            primaryButtonLabel: 'Our practice areas',
            primaryButtonLink: '/services/',
          },
        },
        {
          type: 'announcement_banner',
          props: { message: 'Accepting new clients for the current quarter.', variant: 'info' },
        },
        {
          type: 'service_cards',
          props: {
            title: 'Practice areas',
            items: [
              { title: 'Litigation', description: 'Vigorous representation in court.' },
              { title: 'Corporate', description: 'Transactions and governance.' },
              { title: 'Family law', description: 'Compassionate, discreet counsel.' },
            ],
          },
        },
        {
          type: 'testimonials',
          props: {
            title: 'Client voices',
            quotes: [
              { quote: 'They handled our case with care and precision.', author: 'Private client' },
            ],
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
            heading: 'Our firm',
            content:
              'Founded over three decades ago, our firm has represented clients through their most important legal matters.\n\nWe combine deep legal knowledge with straight answers.',
          },
        },
      ],
    },
    {
      path: '/services',
      title: 'Practice Areas',
      blocks: [
        {
          type: 'service_cards',
          props: {
            title: 'How we can help',
            items: [
              { title: 'Litigation', description: 'Civil and commercial disputes.' },
              { title: 'Corporate', description: 'Formation, contracts, M&A.' },
              { title: 'Family law', description: 'Divorce, custody, mediation.' },
              { title: 'Estate planning', description: 'Wills, trusts, probate.' },
            ],
          },
        },
        {
          type: 'faq',
          props: {
            title: 'Common questions',
            items: [
              {
                question: 'What does an initial consultation cost?',
                answer: 'The first 30 minutes are complimentary.',
              },
              {
                question: 'Do you offer fixed fees?',
                answer: 'Yes, for many matters we quote a fixed fee up front.',
              },
            ],
          },
        },
      ],
    },
    {
      path: '/team',
      title: 'Our Attorneys',
      blocks: [
        {
          type: 'team_members',
          props: {
            title: 'Partners and counsel',
            members: [
              { name: 'Margaret Hale', role: 'Managing Partner' },
              { name: 'David Chen', role: 'Partner, Litigation' },
              { name: 'Priya Nair', role: 'Associate' },
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
          props: { address: '400 Madison Avenue, Suite 1200, New York, NY 10017' },
        },
        {
          type: 'contact_form',
          props: { title: 'Request a consultation', submitLabel: 'Request consultation' },
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
              'Attorney-client communications are privileged and confidential.\n\nWe retain personal information only as required for representation and legal obligations.',
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
              'Information on this website does not constitute legal advice.\n\nContact an attorney to discuss your specific matter.',
          },
        },
      ],
    },
  ],
  theme: {
    colors: { primary: '#1e3a5f', accent: '#b08d57', background: '#faf9f6', text: '#1f2937' },
    fonts: { heading: 'Georgia, serif', body: 'system-ui, sans-serif' },
  },
  seo: {
    titleTemplate: '{title} | Hale & Chen LLP',
    defaultDescription: 'Experienced legal counsel for individuals and businesses.',
    author: 'Hale & Chen LLP',
  },
});
