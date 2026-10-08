import { describe, expect, it } from 'vitest';
import { STORAGE_BACKENDS } from './index.js';

describe('@holonet/storage', () => {
  it('defines local and OSS backends', () => {
    expect(STORAGE_BACKENDS).toEqual(['local', 'oss']);
  });
});
