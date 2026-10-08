import { randomBytes, scrypt } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import {
  closeDatabase,
  createDatabase,
  databaseUrlFromEnv,
  loadEnvFile,
  type HolonetDatabase,
} from './client.js';
import {
  sites,
  templates,
  templateVersions,
  users,
  workspaceMembers,
  workspaces,
  type TemplateManifestJson,
} from './schema.js';

const SCRYPT_KEY_LENGTH = 64;

/**
 * Hashes a password with scrypt (Node crypto — no extra dependencies).
 * Plaintext passwords are never stored (rule 7). Format:
 * `scrypt$<salt hex>$<hash hex>`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await new Promise<Buffer>((resolvePromise, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, (error, derivedKey) => {
      if (error) {
        reject(error);
      } else {
        resolvePromise(derivedKey);
      }
    });
  });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export const SEED_ADMIN_EMAIL = 'admin@holonet.local';
export const SEED_WORKSPACE_SLUG = 'holonet-pilot';
export const SEED_TEMPLATE_NAME = 'Professional Services';
export const SEED_SITE_SLUG = 'pilot-site';

const seedManifest: TemplateManifestJson = {
  name: SEED_TEMPLATE_NAME,
  description: 'Minimal professional services starter (pilot seed).',
  blocks: [
    { type: 'hero', props: { heading: 'Welcome' } },
    { type: 'services', props: { items: [] } },
    { type: 'contact', props: {} },
  ],
};

/**
 * Creates the pilot seed data:
 * 1. Admin user (email admin@holonet.local, password from
 *    ADMIN_INITIAL_PASSWORD — stored as a scrypt hash, never plaintext).
 * 2. Workspace "Holonet Pilot".
 * 3. Template "Professional Services" with a minimal manifest (JSONB).
 * 4. One draft site bound to that template.
 *
 * Idempotent — safe to run repeatedly.
 */
export async function seedDatabase(db: HolonetDatabase, adminPassword: string): Promise<void> {
  // 1. Admin user.
  await db
    .insert(users)
    .values({
      email: SEED_ADMIN_EMAIL,
      passwordHash: await hashPassword(adminPassword),
      role: 'admin',
      status: 'active',
    })
    .onConflictDoNothing();
  const [admin] = await db.select().from(users).where(eq(users.email, SEED_ADMIN_EMAIL));
  if (!admin) {
    throw new Error('seed: admin user not found after upsert');
  }

  // 2. Pilot workspace.
  await db
    .insert(workspaces)
    .values({ name: 'Holonet Pilot', slug: SEED_WORKSPACE_SLUG })
    .onConflictDoNothing();
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, SEED_WORKSPACE_SLUG));
  if (!workspace) {
    throw new Error('seed: workspace not found after upsert');
  }

  // 2b. Admin owns the workspace (tenant access).
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: admin.id, role: 'owner' })
    .onConflictDoNothing();

  // 3. Template with a minimal manifest.
  await db
    .insert(templates)
    .values({ workspaceId: workspace.id, name: SEED_TEMPLATE_NAME, status: 'published' })
    .onConflictDoNothing();
  const [template] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.workspaceId, workspace.id), eq(templates.name, SEED_TEMPLATE_NAME)));
  if (!template) {
    throw new Error('seed: template not found after upsert');
  }

  await db
    .insert(templateVersions)
    .values({
      templateId: template.id,
      version: '1.0.0',
      manifest: seedManifest,
      isCurrent: true,
    })
    .onConflictDoNothing();
  const [templateVersion] = await db
    .select()
    .from(templateVersions)
    .where(
      and(eq(templateVersions.templateId, template.id), eq(templateVersions.version, '1.0.0')),
    );
  if (!templateVersion) {
    throw new Error('seed: template version not found after upsert');
  }

  // 4. One draft site bound to the template.
  await db
    .insert(sites)
    .values({
      workspaceId: workspace.id,
      name: 'Pilot Site',
      slug: SEED_SITE_SLUG,
      status: 'draft',
      templateVersionId: templateVersion.id,
    })
    .onConflictDoNothing();
}

async function main(): Promise<void> {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  loadEnvFile(resolve(rootDir, '.env'));

  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD;
  if (!adminPassword) {
    throw new Error(
      'ADMIN_INITIAL_PASSWORD is not set. Export it or add it to .env (see .env.example).',
    );
  }

  const db = createDatabase(databaseUrlFromEnv());
  try {
    await seedDatabase(db, adminPassword);
    console.log(`[holonet-db] seeded: admin=${SEED_ADMIN_EMAIL} workspace=${SEED_WORKSPACE_SLUG}`);
  } finally {
    await closeDatabase(db);
  }
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  main().catch((error) => {
    console.error('[holonet-db] seed failed:', error);
    process.exitCode = 1;
  });
}
