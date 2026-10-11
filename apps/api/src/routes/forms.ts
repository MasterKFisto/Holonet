import { Hono } from 'hono';
import type { Context } from 'hono';
import { desc, eq } from 'drizzle-orm';
import { formSubmissions, forms, jobs } from '@holonet/db';
import { requireDb } from '../lib/db.js';
import { AppError, errorBody } from '../lib/errors.js';
import { ipHashOf, recordSecurityEvent } from '../lib/security.js';
import { requireFormAccess, requireSiteAccess } from '../middleware/access.js';
import { requireUser } from '../middleware/auth.js';
import { clientIp } from '../middleware/rate-limit.js';
import type { AppEnv } from '../types.js';

/*
 * Public form submission endpoint (POST /forms/:formId).
 *
 * This endpoint is exposed publicly (static sites POST to it from other
 * origins) and is CSRF-exempt by design — see docs/security.md. It carries
 * its own abuse protection instead:
 *  - honeypot field ('website') — bots that fill it are silently discarded;
 *  - per-IP + per-form rate limiting;
 *  - payload size + field-count + value-length caps;
 *  - generic success responses (form existence and spam handling are
 *    never revealed);
 *  - security events for spam and repeated rate-limit abuse.
 */

/** Hidden honeypot field rendered by the static form markup helper. */
const HONEYPOT_FIELD = 'website';

/** Maximum accepted submission body size (64 KiB). */
const MAX_BODY_BYTES = 64 * 1024;
/** Maximum number of fields per submission. */
const MAX_FIELDS = 50;
/** Maximum length of a single field value (10 KiB). */
const MAX_VALUE_LENGTH = 10 * 1024;

/** Rate limit: max submissions per IP + form within the window. */
const FORM_RATE_WINDOW_MS = 60_000;
const FORM_RATE_MAX = 10;
/** Log a security event on the first block and every Nth block after. */
const FORM_BLOCKS_PER_EVENT = 5;

interface FormRateState {
  count: number;
  windowStart: number;
  /** Number of times the limit has tripped (for abuse escalation). */
  blocks: number;
}

/** In-memory limiter (resets on process restart — see docs/security.md). */
const formRateState = new Map<string, FormRateState>();

function formRateKey(ip: string, formId: string): string {
  return `${ip}|${formId}`;
}

/**
 * Returns true when the submission is allowed, false when the limit has
 * been tripped. Repeated trips are escalated as security events.
 */
function allowSubmission(ip: string, formId: string): boolean {
  const now = Date.now();
  const key = formRateKey(ip, formId);
  const state = formRateState.get(key);
  if (!state || now - state.windowStart >= FORM_RATE_WINDOW_MS) {
    formRateState.set(key, { count: 1, windowStart: now, blocks: state?.blocks ?? 0 });
    return true;
  }
  if (state.count < FORM_RATE_MAX) {
    state.count += 1;
    return true;
  }
  state.blocks += 1;
  return false;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parses JSON or form-encoded bodies into a flat record, enforcing size caps. */
async function parseSubmissionBody(c: Context<AppEnv>): Promise<Record<string, string>> {
  const contentType = c.req.header('content-type') ?? '';
  const raw = await c.req.arrayBuffer();
  if (raw.byteLength > MAX_BODY_BYTES) {
    throw new AppError('PAYLOAD_TOO_LARGE', 'payload too large', 413);
  }
  const text = Buffer.from(raw).toString('utf8');
  let record: Record<string, unknown>;
  if (contentType.includes('application/json')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AppError('VALIDATION_ERROR', 'invalid JSON body', 400);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new AppError('VALIDATION_ERROR', 'body must be a JSON object', 400);
    }
    record = parsed as Record<string, unknown>;
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    record = Object.fromEntries(new URLSearchParams(text));
  } else {
    throw new AppError(
      'VALIDATION_ERROR',
      'unsupported content type (expected JSON or form-encoded)',
      415,
    );
  }
  const entries = Object.entries(record);
  if (entries.length > MAX_FIELDS) {
    throw new AppError('VALIDATION_ERROR', 'too many fields', 400);
  }
  const normalized: Record<string, string> = {};
  for (const [key, value] of entries) {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    if (stringValue.length > MAX_VALUE_LENGTH) {
      throw new AppError('VALIDATION_ERROR', `field too long: ${key}`, 400);
    }
    normalized[key] = stringValue;
  }
  return normalized;
}

async function submitHandler(c: Context<AppEnv>): Promise<Response> {
  const formId = c.req.param('formId');
  if (!formId || !UUID_PATTERN.test(formId)) {
    // Safe response: never reveal which form IDs exist.
    return c.json(errorBody({ code: 'NOT_FOUND', message: 'not found' }, c.get('requestId')), 404);
  }
  const db = requireDb(c);
  const ip = clientIp(c);
  const ipHash = ipHashOf(ip);

  if (!allowSubmission(ip, formId)) {
    const state = formRateState.get(formRateKey(ip, formId));
    if (state && state.blocks % FORM_BLOCKS_PER_EVENT === 1) {
      await recordSecurityEvent(db, {
        eventType: 'form_rate_limited',
        severity: 'warning',
        metadata: { formId, ipHash, blocks: state.blocks },
      });
    }
    // Generic success: silently discard (never reveal rate limiting).
    return c.json({ ok: true }, 200);
  }

  let data: Record<string, string>;
  try {
    data = await parseSubmissionBody(c);
  } catch (error) {
    if (error instanceof AppError) {
      return c.json(
        errorBody({ code: error.code, message: error.message }, c.get('requestId')),
        error.status,
      );
    }
    throw error;
  }

  const form = await db.query.forms.findFirst({ where: eq(forms.id, formId) });
  if (!form || form.status !== 'active') {
    // Unknown or disabled form: generic success without any storage.
    return c.json({ ok: true }, 200);
  }

  // Honeypot: bots fill the hidden field — silently discard.
  if (data[HONEYPOT_FIELD] && data[HONEYPOT_FIELD].trim() !== '') {
    await recordSecurityEvent(db, {
      workspaceId: form.workspaceId,
      eventType: 'form_spam_detected',
      severity: 'info',
      metadata: { formId, ipHash, field: HONEYPOT_FIELD },
    });
    return c.json({ ok: true }, 200);
  }

  const honeypotFree = { ...data };
  delete honeypotFree[HONEYPOT_FIELD];

  const [submission] = await db
    .insert(formSubmissions)
    .values({
      formId: form.id,
      workspaceId: form.workspaceId,
      data: honeypotFree,
      ipHash,
      status: 'new',
    })
    .returning({ id: formSubmissions.id });

  // Webhook placeholder: enqueue a notification job for future delivery.
  // No actual webhook is invoked yet — the jobs table is the queue.
  if (form.notificationEmail) {
    await db.insert(jobs).values({
      workspaceId: form.workspaceId,
      type: 'form_notification',
      status: 'pending',
      payload: { submissionId: submission?.id, formId: form.id },
    });
  }

  return c.json({ ok: true }, 200);
}

/** Lists forms for a site (dashboard). */
async function listFormsHandler(c: Context<AppEnv>): Promise<Response> {
  const db = requireDb(c);
  const siteId = c.get('siteId');
  if (!siteId) {
    return c.json(errorBody({ code: 'NOT_FOUND', message: 'not found' }, c.get('requestId')), 404);
  }
  const rows = await db.query.forms.findMany({ where: eq(forms.siteId, siteId) });
  return c.json({ forms: rows });
}

/** Lists submissions for a form (dashboard; workspace members only). */
async function listSubmissionsHandler(c: Context<AppEnv>): Promise<Response> {
  const db = requireDb(c);
  const formId = c.req.param('formId');
  if (!formId) {
    return c.json(errorBody({ code: 'NOT_FOUND', message: 'not found' }, c.get('requestId')), 404);
  }
  const rows = await db.query.formSubmissions.findMany({
    where: eq(formSubmissions.formId, formId),
    orderBy: [desc(formSubmissions.createdAt)],
  });
  return c.json({ submissions: rows });
}

export const formRoutes = new Hono<AppEnv>()
  .post('/forms/:formId', submitHandler)
  .get('/api/sites/:siteId/forms', requireUser, requireSiteAccess(), listFormsHandler)
  .get('/api/forms/:formId/submissions', requireUser, requireFormAccess(), listSubmissionsHandler);
