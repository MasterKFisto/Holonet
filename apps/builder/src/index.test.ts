import { describe, expect, it } from 'vitest';
import { generateSite, type SiteData } from '@holonet/static-generator';
import { handleBuild } from './index.js';

describe('@holonet/builder', () => {
  it('returns a placeholder build result', async () => {
    const result = await handleBuild({ workspaceId: 'ws-1', siteId: 'site-1' });
    expect(result).toEqual({ ok: true, files: 0 });
  });

  it('can invoke the static generator (workspace link check)', async () => {
    const siteData: SiteData = {
      workspaceId: 'ws-1',
      siteId: 'site-1',
      template: { id: 'tpl-1', name: 'Starter', version: '1.0.0', blocks: [] },
    };
    const files = await generateSite(siteData);
    expect(Array.isArray(files)).toBe(true);
  });
});
