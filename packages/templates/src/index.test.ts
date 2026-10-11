import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATE_PAGES,
  getTemplate,
  holonetTemplates,
  templateManifestSchema,
} from './index.js';

describe('@holonet/templates', () => {
  it('ships the three initial templates', () => {
    expect(holonetTemplates.map((template) => template.id)).toEqual([
      'professional-services',
      'law-firm',
      'accounting-firm',
    ]);
  });

  it('every template declares the default pages', () => {
    for (const template of holonetTemplates) {
      const paths = template.pages.map((page) => page.path);
      for (const defaultPage of DEFAULT_TEMPLATE_PAGES) {
        expect(paths, `${template.id} should include ${defaultPage.path}`).toContain(
          defaultPage.path,
        );
      }
    }
  });

  it('every template declares version, theme, and SEO defaults', () => {
    for (const template of holonetTemplates) {
      expect(template.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(template.theme).toBeDefined();
      expect(template.seo.titleTemplate).toContain('{title}');
    }
  });

  it('rejects manifests with unknown block types', () => {
    const result = templateManifestSchema.safeParse({
      id: 'broken',
      name: 'Broken',
      version: '1.0.0',
      pages: [{ path: '/', title: 'Home', blocks: [{ type: 'spaceship', props: {} }] }],
    });
    expect(result.success).toBe(false);
  });

  it('looks templates up by id', () => {
    expect(getTemplate('law-firm')?.name).toBe('Law Firm');
    expect(getTemplate('missing')).toBeUndefined();
  });
});
