import { createApp } from './app.js';

/**
 * Alibaba Cloud Function Compute entrypoint (HTTP trigger).
 *
 * PLACEHOLDER: assumes FC HTTP triggers pass a Web Request and expect a Web
 * Response. Confirm the runtime/trigger signature before deployment and
 * document it in infra/alibaba/README.md (docs/PROJECT_RULES.md rule 16).
 * FC injects configuration via environment variables, so createApp() works
 * unchanged.
 */
export async function handler(req: Request, env: Record<string, string>): Promise<Response> {
  return createApp().fetch(req, env);
}
