import { handleMessage } from '../services/conversation.js';

/**
 * POST /api/whatsapp/webhook
 * Kapso calls this when a patient sends a WhatsApp message.
 */
export async function whatsappRoute(app) {
  app.post('/whatsapp/webhook', async (req, reply) => {
    const { from, text, type } = req.body ?? {};

    // Only handle text messages
    if (type !== 'text' || !from || !text) {
      return reply.code(200).send({ ok: true });
    }

    const phone = String(from).replace(/\D/g, '');

    try {
      const response = await handleMessage(phone, text);
      return { ok: true, reply: response };
    } catch (err) {
      req.log.error({ err }, 'WhatsApp conversation error');
      return { ok: true, reply: 'Hubo un error. Por favor intenta de nuevo.' };
    }
  });
}
