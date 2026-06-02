import { createHmac, timingSafeEqual } from 'crypto';
import { WhatsAppClient } from '@kapso/whatsapp-cloud-api';
import { handleMessage } from '../services/conversation.js';

const kapso = new WhatsAppClient({
  baseUrl: 'https://app.kapso.ai/api/meta/',
  kapsoApiKey: process.env.KAPSO_API_KEY,
});

const PHONE_NUMBER_ID   = process.env.KAPSO_PHONE_NUMBER_ID;
const WEBHOOK_SECRET    = process.env.KAPSO_WEBHOOK_SECRET;
// Group where the doctor's personal + professional phones coexist.
// When set, medical escalations are posted here as a brief abstract.
// Leave unset until Mario creates the group and shares the chat ID.
const ESCALATION_CHAT_ID = process.env.ESCALATION_CHAT_ID;

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

async function sendText(to, text) {
  await kapso.messages.sendText({
    phoneNumberId: PHONE_NUMBER_ID,
    to: to.startsWith('+') ? to : `+${to}`,
    body: text,
  });
}

async function sendEscalation(abstract) {
  if (!ESCALATION_CHAT_ID) {
    // Group not configured yet — log on server so the doctor can still be informed manually
    console.warn('[escalation] ESCALATION_CHAT_ID not set. Abstract:\n', abstract);
    return;
  }
  try {
    await sendText(ESCALATION_CHAT_ID, abstract);
  } catch (err) {
    console.error('[escalation] Failed to send to group:', err);
  }
}

/**
 * POST /api/whatsapp/webhook
 * Kapso calls this for every incoming WhatsApp message.
 *
 * Non-text messages (photos, audio, documents) are escalated immediately —
 * patients may be trying to share images of symptoms.
 */
export async function whatsappRoute(app) {
  app.post('/whatsapp/webhook', async (req, reply) => {
    const sig = req.headers['x-webhook-signature'];
    if (!verifySignature(req.rawBody, sig)) {
      req.log.warn('WhatsApp webhook: invalid signature');
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    const { message } = req.body ?? {};
    if (!message || !message.from) {
      return reply.code(200).send({ ok: true });
    }

    const phone = String(message.from).replace(/\D/g, '');

    reply.code(200).send({ ok: true }); // respond immediately so Kapso doesn't retry

    // ── Non-text messages (photo, video, document, audio) ──
    // Patient may be sharing an image of a symptom — escalate, never process.
    if (message.type !== 'text') {
      const mediaReply = `Gracias por escribirnos. Para consultas médicas o compartir documentos, comunícate directamente con el consultorio. Este canal es solo para agendar citas. 📅`;
      const abstract   = `⚠️ *Derivación automática — bot Expedicta*\n\n📱 Paciente: +${phone}\nMotivo: Envió un archivo multimedia (${message.type})\n\nPor favor atiende directamente a este paciente.`;

      try { await sendText(phone, mediaReply); } catch { /* ignore */ }
      await sendEscalation(abstract);
      return;
    }

    // ── Text messages — run through state machine ──
    const text = message.text?.body ?? '';
    try {
      const result = await handleMessage(phone, text);
      await sendText(phone, result.reply);

      if (result.escalation) {
        await sendEscalation(result.escalation.abstract);
      }
    } catch (err) {
      req.log.error({ err }, 'WhatsApp conversation error');
      try {
        await sendText(phone, 'Hubo un error. Por favor intenta de nuevo.');
      } catch { /* ignore secondary error */ }
    }
  });
}
