import { describe, expect, it } from 'vitest';
import type { HolonetDatabase } from '@holonet/db';
import type { StorageProvider } from '@holonet/storage';
import { buildSite } from './build.js';
import { handler } from './handler.js';

describe('@holonet/builder', () => {
  it('rejects invalid build events in the FC handler', async () => {
    await expect(handler({ siteId: 'not-a-uuid', deploymentId: 'nope' })).rejects.toThrow(
      /invalid build event/,
    );
  });

  it('rejects builds for unknown deployments', async () => {
    const db = {
      query: { deployments: { findFirst: async () => undefined } },
    } as unknown as HolonetDatabase;
    const storage = {} as StorageProvider;
    await expect(
      buildSite(
        {
          siteId: '00000000-0000-4000-8000-000000000001',
          deploymentId: '00000000-0000-4000-8000-000000000002',
        },
        {
          db,
          storage,
          publicBaseUrl: 'https://holonet.section-zero.link',
        },
      ),
    ).rejects.toThrow(/not found/);
  });
});
