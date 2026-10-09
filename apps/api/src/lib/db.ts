import type { HolonetDatabase } from '@holonet/db';
import type { StorageProvider } from '@holonet/storage';
import type { Context } from 'hono';
import { AppError } from './errors.js';
import type { AppEnv } from '../types.js';

/** Returns the request-scoped database, failing loudly when unconfigured. */
export function requireDb(c: Context<AppEnv>): HolonetDatabase {
  const db = c.get('db');
  if (!db) {
    throw new AppError('INVALID_CONFIG', 'DATABASE_URL is not configured', 500);
  }
  return db;
}

/** Returns the request-scoped storage provider, failing loudly when unconfigured. */
export function requireStorage(c: Context<AppEnv>): StorageProvider {
  const storage = c.get('storage');
  if (!storage) {
    throw new AppError('INVALID_CONFIG', 'storage provider is not configured', 500);
  }
  return storage;
}
