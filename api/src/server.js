import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import cookie from '@fastify/cookie';
import { authPlugin } from './plugins/auth.js';
import { transcribeRoute } from './routes/transcribe.js';
import { sessionsRoute } from './routes/sessions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(cookie);
await app.register(multipart, {
  limits: { fileSize: 30 * 1024 * 1024 },
});
await app.register(staticPlugin, {
  root: join(__dirname, '..', 'public'),
  prefix: '/',
});

await app.register(authPlugin);
await app.register(transcribeRoute, { prefix: '/api' });
await app.register(sessionsRoute,   { prefix: '/api' });

app.get('/health', async () => ({ ok: true }));

const port = parseInt(process.env.PORT ?? '3000');
try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
