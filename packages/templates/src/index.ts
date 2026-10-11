export * from './schema.js';

import { accountingFirmTemplate } from './templates/accounting-firm.js';
import { lawFirmTemplate } from './templates/law-firm.js';
import { professionalServicesTemplate } from './templates/professional-services.js';
import type { TemplateManifest } from './schema.js';

/** Built-in Holonet templates, validated against templateManifestSchema. */
export const holonetTemplates: TemplateManifest[] = [
  professionalServicesTemplate,
  lawFirmTemplate,
  accountingFirmTemplate,
];

export { accountingFirmTemplate, lawFirmTemplate, professionalServicesTemplate };

export function getTemplate(id: string): TemplateManifest | undefined {
  return holonetTemplates.find((template) => template.id === id);
}
