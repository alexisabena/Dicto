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
import { whatsappRoute } from './routes/whatsapp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

// Store raw body buffer so the WhatsApp webhook can verify Kapso's HMAC signature.
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  req.rawBody = body;
  try { done(null, JSON.parse(body)); }
  catch (err) { err.statusCode = 400; done(err); }
});

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
await app.register(whatsappRoute,   { prefix: '/api' });

app.get('/health', async () => ({ ok: true }));

const port = parseInt(process.env.PORT ?? '3000');
try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
