import { describe, expect, it } from 'vitest';
import { generateSite, type SiteData } from './index.js';

describe('@holonet/static-generator', () => {
  it('returns an empty file list (placeholder)', async () => {
    const siteData: SiteData = {
      workspaceId: 'ws-1',
      siteId: 'site-1',
      template: { id: 'tpl-1', name: 'Starter', version: '1.0.0', blocks: [] },
    };
    expect(await generateSite(siteData)).toEqual([]);
  });
});
