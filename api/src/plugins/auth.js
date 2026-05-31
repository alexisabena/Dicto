import { createHmac } from 'crypto';

const COOKIE_NAME = 'exp_session';
const COOKIE_DAYS = 30;

function makeToken(secret) {
  return createHmac('sha256', secret).update('authenticated').digest('hex');
}

export async function authPlugin(app) {
  const pin    = process.env.ACCESS_PIN;
  const secret = process.env.COOKIE_SECRET;

  if (!pin || !secret) {
    throw new Error('ACCESS_PIN and COOKIE_SECRET must be set in .env');
  }

  const validToken = makeToken(secret);
  const isProd     = process.env.NODE_ENV === 'production';

  // ── Public routes ────────────────────────────────────
  app.post('/api/auth/login', async (req, reply) => {
    const submitted = String(req.body?.pin ?? '');
    if (submitted !== String(pin)) {
      return reply.code(401).send({ error: 'Wrong PIN' });
    }
    reply.setCookie(COOKIE_NAME, validToken, {
      httpOnly: true,
      secure:   isProd,
      sameSite: 'strict',
      maxAge:   60 * 60 * 24 * COOKIE_DAYS,
      path:     '/',
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return reply.redirect('/login.html');
  });

  // ── Auth guard — fires on every request ─────────────
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];

    const isPublic =
      path === '/health'            ||
      path === '/login.html'        ||
      path === '/api/auth/login'    ||
      path === '/api/auth/logout';

    if (isPublic) return;

    const token = req.cookies?.[COOKIE_NAME];
    if (token === validToken) return;

    // API call without auth → 401 JSON
    if (path.startsWith('/api/')) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    // Page request without auth → redirect to login
    return reply.redirect('/login.html');
  });
}
