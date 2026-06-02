/**
 * conversation.js — Claude Haiku-powered WhatsApp conversation engine
 *
 * Replaces the rigid state machine with Haiku as the brain.
 * Haiku handles free-form Spanish, edge cases, and tool calls
 * (get_available_slots, book_appointment) to interact with Google Calendar.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getAvailableSlots, bookSlot, DOCTOR_NAME } from './calendar.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 min idle resets conversation

// In-memory sessions keyed by phone number.
// { [phone]: { messages: Message[], updatedAt: number } }
const sessions = new Map();

// ── System prompt ─────────────────────────────────────
// Cached — it never changes per request, so we mark it ephemeral
// to hit Anthropic's prompt cache on repeated calls.
const SYSTEM = `Eres el asistente virtual del consultorio del Dr. Mario León, oftalmólogo en Puebla, México.
Tu función principal es agendar citas para los pacientes.

INFORMACIÓN DEL CONSULTORIO
Médico: Dr. Mario León (oftalmólogo)
Dirección: Blvd. Lic. Luis Sánchez Pontón 616, Col. Anzures, 72530 Heroica Puebla de Zaragoza, Pue., México
Google Maps: https://maps.app.goo.gl/Yqhb6rgZ3E3XRUhf8
Horario: Lunes a viernes 8:00–12:00 y 13:00–19:00 | Sábados 8:00–12:00
(El horario puede variar por cirugías — los horarios disponibles los consultas en tiempo real)

TIPOS DE CITA (todas 60 minutos)
- Primera vez: primer contacto con el Dr. León
- Seguimiento: revisión de paciente ya atendido
- Procedimiento: intervención o tratamiento programado
- Urgencia: problema ocular urgente

FLUJO PARA AGENDAR
1. Saluda con calidez si es el primer mensaje
2. Si el paciente no indicó el tipo de cita, pregúntalo
3. Pide el nombre completo del paciente
4. Usa get_available_slots para consultar horarios disponibles
5. Presenta máximo 5 opciones de forma clara y amigable
6. Cuando el paciente elija y confirme, usa book_appointment

MANEJO DE SITUACIONES ESPECIALES
- Dirección / cómo llegar: comparte la dirección completa y el link de Google Maps
- Paciente molesto o frustrado: responde con empatía, ofrece ayuda concreta, no te pongas a la defensiva
- Paciente grosero: mantén la calma, sé amable, no respondas el tono
- Urgencias: consulta slots disponibles hoy; si no hay, indica "Para urgencias inmediatas comunícate directamente con el consultorio"
- Preguntas médicas (diagnósticos, síntomas, tratamientos): no respondas, redirige al Dr. León
- Preguntas que no puedes resolver: "Para más información comunícate directamente con el consultorio"
- Cancelaciones o cambios de cita: disculpate, indica que por el momento los cambios se gestionan llamando al consultorio directamente

ESTILO DE COMUNICACIÓN
- Siempre en español
- Cálido, profesional y breve — esto es WhatsApp, no un correo
- Usa emojis con moderación (👍 ✅ 📅 están bien, no abuses)
- No inventes información que no tengas`;

// ── Tool definitions ──────────────────────────────────
const TOOLS = [
  {
    name: 'get_available_slots',
    description: 'Consulta los horarios disponibles para agendar una cita. Úsalo cuando el paciente quiera agendar o ver opciones de horario.',
    input_schema: {
      type: 'object',
      properties: {
        appointment_type: {
          type: 'string',
          enum: ['Primera vez', 'Seguimiento', 'Procedimiento', 'Urgencia'],
          description: 'Tipo de cita solicitada',
        },
      },
      required: ['appointment_type'],
    },
  },
  {
    name: 'book_appointment',
    description: 'Registra la cita en el calendario del Dr. León. Úsalo solo después de que el paciente haya confirmado explícitamente el horario.',
    input_schema: {
      type: 'object',
      properties: {
        start_iso:        { type: 'string', description: 'Fecha y hora de inicio (ISO 8601)' },
        end_iso:          { type: 'string', description: 'Fecha y hora de fin (ISO 8601)' },
        patient_name:     { type: 'string', description: 'Nombre completo del paciente' },
        appointment_type: { type: 'string', description: 'Tipo de cita' },
        slot_label:       { type: 'string', description: 'Etiqueta legible del horario, ej: "lun 2 jun, 10:00 AM"' },
      },
      required: ['start_iso', 'end_iso', 'patient_name', 'appointment_type'],
    },
  },
];

// ── Main entry point ──────────────────────────────────
/**
 * Handle an incoming WhatsApp message.
 * Returns the reply string to send back to the patient.
 */
export async function handleMessage(phone, text) {
  let session = sessions.get(phone);

  // Reset stale sessions
  if (session && Date.now() - session.updatedAt > SESSION_TIMEOUT_MS) {
    session = null;
  }
  if (!session) {
    session = { messages: [], updatedAt: Date.now() };
  }

  session.messages.push({ role: 'user', content: text });
  session.updatedAt = Date.now();
  sessions.set(phone, session);

  // ── Agentic loop ─────────────────────────────────────
  // Haiku may call tools before giving the final text reply.
  let response = await callHaiku(session.messages);

  while (response.stop_reason === 'tool_use') {
    const toolBlock = response.content.find(b => b.type === 'tool_use');
    const toolResult = await executeTool(toolBlock.name, toolBlock.input, phone);

    session.messages.push({ role: 'assistant', content: response.content });
    session.messages.push({
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: JSON.stringify(toolResult),
      }],
    });

    response = await callHaiku(session.messages);
  }

  // Extract final text reply
  const reply = response.content.find(b => b.type === 'text')?.text
    ?? 'Lo siento, hubo un error. Por favor intenta de nuevo.';

  session.messages.push({ role: 'assistant', content: response.content });
  sessions.set(phone, session);

  return reply;
}

// ── Anthropic API call ────────────────────────────────
function callHaiku(messages) {
  return anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: TOOLS,
    messages,
  });
}

// ── Tool execution ────────────────────────────────────
async function executeTool(name, input, phone) {
  if (name === 'get_available_slots') {
    try {
      const slots = await getAvailableSlots(8, 60);
      if (slots.length === 0) {
        return { available: false, message: 'No hay horarios disponibles en los próximos días.' };
      }
      return {
        available: true,
        slots: slots.map(s => ({
          label:     s.label,
          start_iso: s.start.toISO(),
          end_iso:   s.end.toISO(),
        })),
      };
    } catch (err) {
      console.error('[tool] get_available_slots error:', err);
      return { error: 'No se pudo consultar el calendario en este momento.' };
    }
  }

  if (name === 'book_appointment') {
    try {
      await bookSlot({
        startISO:     input.start_iso,
        endISO:       input.end_iso,
        patientName:  input.patient_name,
        patientPhone: phone,
        type:         input.appointment_type,
      });
      return { success: true };
    } catch (err) {
      console.error('[tool] book_appointment error:', err);
      return { error: 'No se pudo registrar la cita. Por favor intenta de nuevo.' };
    }
  }

  return { error: `Herramienta desconocida: ${name}` };
}
