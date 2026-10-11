import { describe, expect, it } from 'vitest';
import { professionalServicesTemplate } from '@holonet/templates';
import { generateStaticSite } from '@holonet/static-generator';
import { handleBuild } from './index.js';

describe('@holonet/builder', () => {
  it('returns a placeholder build result', async () => {
    const result = await handleBuild({ workspaceId: 'ws-1', siteId: 'site-1' });
    expect(result).toEqual({ ok: true, files: 0 });
  });

  it('can invoke the static generator (workspace link check)', async () => {
    const output = await generateStaticSite({
      workspaceId: 'ws-1',
      siteId: 'site-1',
      siteName: 'Example Firm',
      baseUrl: 'https://holonet.section-zero.link',
      template: professionalServicesTemplate,
      pages: [],
    });
    expect(output.files['index.html']).toBeTruthy();
    expect(output.files['sitemap.xml']).toBeTruthy();
  });
});
