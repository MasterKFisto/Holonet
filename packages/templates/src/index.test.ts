import { describe, expect, it } from 'vitest';
import { templateManifestSchema } from './index.js';

describe('@holonet/templates', () => {
  it('validates a minimal manifest', () => {
    const manifest = templateManifestSchema.parse({
      id: 'tpl-1',
      name: 'Starter',
      version: '1.0.0',
      blocks: [{ id: 'b1', type: 'hero', content: { title: 'Hello' } }],
    });
    expect(manifest.blocks).toHaveLength(1);
  });
});
