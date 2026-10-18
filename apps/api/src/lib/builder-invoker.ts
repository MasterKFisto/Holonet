import type { HolonetDatabase } from '@holonet/db';
import type { StorageProvider } from '@holonet/storage';
import { buildSite } from '@holonet/builder';
import { AppError } from './errors.js';
import { FcBuilderInvoker } from '../invokers/fc-builder-invoker.js';

/**
 * Builder invocation abstraction.
 *
 * - LocalBuilderInvoker runs the build in-process (local development).
 * - FcBuilderInvoker invokes the holonet-builder Function Compute function
 *   asynchronously (BUILDER_INVOKER=fc) — see invokers/fc-builder-invoker.ts.
 */

export interface BuilderInvoker {
  readonly kind: 'local' | 'fc';
  invokeBuild(siteId: string, deploymentId: string): Promise<void>;
}

export interface BuilderInvokerDeps {
  db?: HolonetDatabase;
  storage: StorageProvider;
  publicBaseUrl: string;
}

export class LocalBuilderInvoker implements BuilderInvoker {
  readonly kind = 'local' as const;

  constructor(private readonly deps: BuilderInvokerDeps) {}

  async invokeBuild(siteId: string, deploymentId: string): Promise<void> {
    const { db } = this.deps;
    if (!db) {
      throw new AppError('INVALID_CONFIG', 'DATABASE_URL is not configured', 500);
    }
    await buildSite(
      { siteId, deploymentId },
      { db, storage: this.deps.storage, publicBaseUrl: this.deps.publicBaseUrl },
    );
  }
}

/** Selects the invoker from BUILDER_INVOKER (default: local, Zod-validated). */
export function createBuilderInvoker(kind: string, deps: BuilderInvokerDeps): BuilderInvoker {
  if (kind === 'fc') {
    return new FcBuilderInvoker(deps);
  }
  if (kind !== 'local') {
    throw new AppError('INVALID_CONFIG', `unknown BUILDER_INVOKER: ${kind}`, 500);
  }
  return new LocalBuilderInvoker(deps);
}
