import { describe, expect, it } from 'vitest';
import { aiImportProviders } from './index.js';

describe('@holonet/ai', () => {
  it('starts with no registered providers', () => {
    expect(aiImportProviders).toEqual([]);
  });
});
