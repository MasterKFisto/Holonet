import { describe, expect, it } from 'vitest';
import { BLOCK_TYPES, validateBlock } from './blocks.js';

describe('@holonet/core block schemas', () => {
  it('defines all twelve initial block types', () => {
    expect(BLOCK_TYPES).toHaveLength(12);
    expect(BLOCK_TYPES).toContain('hero');
    expect(BLOCK_TYPES).toContain('cta_section');
  });

  it('accepts a valid hero block and strips unknown keys', () => {
    const result = validateBlock('hero', { headline: 'Welcome', alignment: 'center', evil: 'x' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.props).toEqual({ headline: 'Welcome', alignment: 'center' });
    }
  });

  it('rejects missing required props', () => {
    const result = validateBlock('hero', { subheadline: 'only optional props here' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some((issue) => issue.path === 'props.headline')).toBe(true);
    }
  });

  it('rejects unknown block types', () => {
    const result = validateBlock('rocket_ship', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.message).toContain('unknown block type');
    }
  });

  it('validates a nested list block', () => {
    const good = validateBlock('faq', { items: [{ question: 'Q?', answer: 'A.' }] });
    expect(good.ok).toBe(true);

    const bad = validateBlock('faq', { items: [] });
    expect(bad.ok).toBe(false);
  });
});
