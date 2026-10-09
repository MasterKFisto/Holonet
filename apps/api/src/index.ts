import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();

serve({ fetch: createApp(env).fetch, port: env.PORT }, (info) => {
  console.log(`[holonet-api] listening on http://localhost:${info.port} (${env.NODE_ENV})`);
});
