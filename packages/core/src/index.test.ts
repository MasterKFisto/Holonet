import { describe, expect, it } from 'vitest';
import { DEFAULT_PUBLIC_BASE_URL, SERVICE_NAME, publicBaseUrl } from './index.js';

describe('@holonet/core', () => {
  it('identifies the service', () => {
    expect(SERVICE_NAME).toBe('holonet');
  });

  it('falls back to the fixed public hostname', () => {
    const previous = process.env.PUBLIC_BASE_URL;
    delete process.env.PUBLIC_BASE_URL;
    try {
      expect(publicBaseUrl()).toBe(DEFAULT_PUBLIC_BASE_URL);
    } finally {
      if (previous !== undefined) {
        process.env.PUBLIC_BASE_URL = previous;
      }
    }
  });
});
