import { describe, expect, it } from 'vitest';
import { CACHE_CONTROL, CONTENT_TYPES, contentTypeFor, extensionOf } from './content-types.js';

describe('@holonet/storage content types', () => {
  it('maps every required extension', () => {
    expect(CONTENT_TYPES).toMatchObject({
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      svg: 'image/svg+xml',
      css: 'text/css',
      js: 'text/javascript',
      html: 'text/html',
      json: 'application/json',
    });
  });

  it('resolves content types case-insensitively', () => {
    expect(contentTypeFor('photo.JPG')).toBe('image/jpeg');
    expect(contentTypeFor('app.CSS')).toBe('text/css');
    expect(contentTypeFor('data.JSON')).toBe('application/json');
    expect(contentTypeFor('unknown.bin')).toBeUndefined();
    expect(extensionOf('no-extension')).toBe('');
  });

  it('provides cache-control values', () => {
    expect(CACHE_CONTROL.IMMUTABLE).toContain('immutable');
    expect(CACHE_CONTROL.NONE).toBe('no-cache');
  });
});
