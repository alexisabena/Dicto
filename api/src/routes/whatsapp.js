import { createHmac, timingSafeEqual } from 'crypto';
import { WhatsAppClient } from '@kapso/whatsapp-cloud-api';
import { handleMessage } from '../services/conversation.js';

const kapso = new WhatsAppClient({
  baseUrl: 'https://app.kapso.ai/api/meta/',
  kapsoApiKey: process.env.KAPSO_API_KEY,
});

const PHONE_NUMBER_ID = process.env.KAPSO_PHONE_NUMBER_ID;
const WEBHOOK_SECRET  = process.env.KAPSO_WEBHOOK_SECRET;

function verifySignature(rawBody, header) {
  if (!WEBHOOK_SECRET) return true; // skip in dev if secret not set
  if (!header) return false;
  const expected = createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function sendReply(to, text) {
  await kapso.messages.sendText({
    phoneNumberId: PHONE_NUMBER_ID,
    to: `+${to}`,
    text: { body: text },
  });
}

/**
 * POST /api/whatsapp/webhook
 * Kapso calls this for every incoming WhatsApp message.
 * Payload: { message: { from, type, text: { body } }, conversation: {...} }
 */
export async function whatsappRoute(app) {
  app.post('/whatsapp/webhook', async (req, reply) => {
    // Signature check — Kapso sends X-Webhook-Signature as hmac-sha256-hex
    const sig = req.headers['x-webhook-signature'];
    if (!verifySignature(req.rawBody, sig)) {
      req.log.warn('WhatsApp webhook: invalid signature');
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    const { message } = req.body ?? {};
    if (!message || message.type !== 'text' || !message.from) {
      return reply.code(200).send({ ok: true }); // ignore non-text events
    }

    const phone = String(message.from).replace(/\D/g, '');
    const text  = message.text?.body ?? '';

    reply.code(200).send({ ok: true }); // respond immediately so Kapso doesn't retry

    try {
      const response = await handleMessage(phone, text);
      await sendReply(phone, response);
    } catch (err) {
      req.log.error({ err }, 'WhatsApp conversation error');
      try {
        await sendReply(phone, 'Hubo un error. Por favor intenta de nuevo.');
      } catch { /* ignore secondary error */ }
    }
  });
}
