import { describe, expect, it } from 'vitest';
import type { HolonetDatabase } from '@holonet/db';
import type { StorageProvider } from '@holonet/storage';
import { buildSite } from './build.js';
import { handler, parseBuildEvent } from './handler.js';

describe('@holonet/builder', () => {
  it('rejects invalid build events in the FC handler', async () => {
    await expect(handler({ siteId: 'not-a-uuid', deploymentId: 'nope' })).rejects.toThrow(
      /invalid build event/,
    );
  });

  it('rejects non-JSON Buffer payloads in the FC handler', async () => {
    await expect(handler(Buffer.from('not-json{'))).rejects.toThrow(
      /invalid build event: payload is not valid JSON/,
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

describe('parseBuildEvent (FC3 event-function payload)', () => {
  const valid = {
    siteId: '00000000-0000-4000-8000-000000000001',
    deploymentId: '00000000-0000-4000-8000-000000000002',
  };

  it('parses a plain object (console testing)', () => {
    expect(parseBuildEvent(valid)).toEqual(valid);
  });

  it('parses a Buffer payload (FC3 async invocation delivery)', () => {
    expect(parseBuildEvent(Buffer.from(JSON.stringify(valid)))).toEqual(valid);
  });

  it('parses a JSON string payload', () => {
    expect(parseBuildEvent(JSON.stringify(valid))).toEqual(valid);
  });

  it('rejects a non-JSON string', () => {
    expect(() => parseBuildEvent('{oops')).toThrow(/not valid JSON/);
  });

  it('rejects a JSON payload with the wrong shape', () => {
    expect(() => parseBuildEvent(Buffer.from(JSON.stringify({ siteId: 'x' })))).toThrow(
      /invalid build event/,
    );
  });
});
