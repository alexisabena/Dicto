/**
 * conversation.js — WhatsApp scheduling bot (state machine)
 *
 * Scope: appointment booking only.
 * Any medical content (symptoms, advice, photos) is immediately escalated
 * to the doctor's professional group — the bot never responds to clinical content.
 */

import { getAvailableSlots, bookSlot, DOCTOR_NAME } from './calendar.js';

// ── Session store ─────────────────────────────────────
// In-memory, keyed by phone. Resets after 15 min idle.
const sessions = new Map();
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;

// ── Appointment types ─────────────────────────────────
const APPT_TYPES = [
  { key: '1', label: 'Primera vez',   duration: 60 },
  { key: '2', label: 'Seguimiento',   duration: 60 },
  { key: '3', label: 'Procedimiento', duration: 60 },
  { key: '4', label: 'Urgencia',      duration: 60 },
];

// ── Medical escalation detection ──────────────────────
// Catches symptom descriptions, medical advice requests, and prescription content.
// When triggered the bot redirects the patient and notifies the doctor's group.
const MEDICAL_PATTERN = /\b(me duele|me está doliendo|dolor (de|en|ocular)|sangr[aeo]|no veo|perdí (la )?visión|visión borrosa|visión nublada|ojo rojo|ojo inflamado|hinchad[ao]|ardor|picazón|picor|lagrimeo|se me nubló|manchas en la visión|destellos|luces en la visión|golpe en el ojo|me cayó algo|me entró algo|receta médica|medicamento|medicina|pastilla|gotas para|qué tengo|qué puede ser|es grave|es normal que|debería (preocuparme|ir urgente|tomar)|alergia ocular|infección ocular|conjuntivitis|cataratas|glaucoma|desprendimiento de retina|urgencia médica|emergencia médica|me operaron y)\b/i;

function isMedicalContent(text) {
  return MEDICAL_PATTERN.test(text);
}

// ── Escalation message (sent to doctor's group) ───────
function buildEscalationAbstract(phone, text, reason) {
  return [
    `⚠️ *Derivación automática — bot Expedicta*`,
    ``,
    `📱 Paciente: +${phone}`,
    `Motivo: ${reason}`,
    `Último mensaje: "_${text.slice(0, 120)}${text.length > 120 ? '...' : ''}_"`,
    ``,
    `Por favor atiende directamente a este paciente.`,
  ].join('\n');
}

// ── Main entry point ──────────────────────────────────
/**
 * Handle an incoming WhatsApp text message.
 * Returns { reply: string, escalation?: { abstract: string } }
 *
 * The caller (whatsapp.js) sends reply to the patient and,
 * if escalation is present, sends the abstract to ESCALATION_CHAT_ID.
 */
export async function handleMessage(phone, text) {
  const msg = text.trim();

  // Hard stop — medical content
  if (isMedicalContent(msg)) {
    return {
      reply: `Gracias por escribirnos. Para consultas médicas, síntomas o dudas clínicas necesitas hablar directamente con el Dr. León — este canal es solo para agendar citas. 📅\n\nSi deseas programar una cita, con gusto te ayudo.`,
      escalation: {
        abstract: buildEscalationAbstract(phone, msg, 'Descripción de síntoma o consulta médica'),
      },
    };
  }

  // Normal booking flow
  const reply = await runStateMachine(phone, msg);
  return { reply };
}

// ── Booking state machine ─────────────────────────────
async function runStateMachine(phone, msg) {
  let session = sessions.get(phone);

  if (session && Date.now() - session.updatedAt > SESSION_TIMEOUT_MS) {
    session = null;
  }

  if (!session || isGreeting(msg)) {
    sessions.set(phone, { step: 'ask_type', data: {}, updatedAt: Date.now() });
    return replyAskType();
  }

  touch(phone, session);

  switch (session.step) {
    case 'ask_type': return handleAskType(phone, session, msg);
    case 'ask_name': return handleAskName(phone, session, msg);
    case 'ask_slot': return handleAskSlot(phone, session, msg);
    case 'confirm':  return handleConfirm(phone, session, msg);
    default:
      sessions.delete(phone);
      return replyAskType();
  }
}

// ── Step handlers ─────────────────────────────────────

function handleAskType(phone, session, msg) {
  const choice = APPT_TYPES.find(t => t.key === msg.trim());
  if (!choice) {
    return `Por favor responde con el número de tu opción:\n\n${apptTypeList()}`;
  }
  session.data.type     = choice.label;
  session.data.duration = choice.duration;
  session.step          = 'ask_name';
  return `¿Cuál es el nombre completo del paciente?`;
}

function handleAskName(phone, session, msg) {
  if (msg.length < 2) return `¿Puedes compartirme el nombre completo?`;
  session.data.name = capitalize(msg);
  session.step      = 'ask_slot';
  return fetchAndShowSlots(phone, session);
}

async function handleAskSlot(phone, session, msg) {
  const idx   = parseInt(msg) - 1;
  const slots = session.data.slots || [];

  if (isNaN(idx) || idx < 0 || idx >= slots.length) {
    return `Por favor elige un número del 1 al ${slots.length}:\n\n${slotList(slots)}`;
  }

  session.data.chosenSlot = slots[idx];
  session.step            = 'confirm';

  const s = slots[idx];
  return [
    `Confirma tu cita:`,
    ``,
    `📅 ${s.label}`,
    `👨‍⚕️ ${DOCTOR_NAME}`,
    `📋 ${session.data.type}`,
    `📍 Blvd. Luis Sánchez Pontón 616, Col. Anzures, Puebla`,
    ``,
    `¿Confirmamos? Responde *sí* o *no*`,
  ].join('\n');
}

async function handleConfirm(phone, session, msg) {
  const yes = /^(s[ií]|yes|ok|dale|va|confirm)/i.test(msg);
  const no  = /^(no|cancel|nope)/i.test(msg);

  if (!yes && !no) return `Responde *sí* para confirmar o *no* para elegir otro horario.`;

  if (no) {
    session.step = 'ask_slot';
    return `Sin problema. Elige otro horario:\n\n${slotList(session.data.slots)}`;
  }

  const slot = session.data.chosenSlot;
  try {
    await bookSlot({
      startISO:    slot.start.toISO(),
      endISO:      slot.end.toISO(),
      patientName: session.data.name,
      patientPhone: phone,
      type:         session.data.type,
    });
  } catch (err) {
    console.error('[booking] Calendar error:', err);
    return `Tuvimos un problema al registrar la cita. Por favor intenta de nuevo o llama directamente al consultorio.`;
  }

  sessions.delete(phone);

  return [
    `✅ *Cita confirmada*`,
    ``,
    `📅 ${slot.label}`,
    `👨‍⚕️ ${DOCTOR_NAME}`,
    `📋 ${session.data.type}`,
    `📍 Blvd. Luis Sánchez Pontón 616, Col. Anzures, Puebla`,
    `🗺️ https://maps.app.goo.gl/Yqhb6rgZ3E3XRUhf8`,
    ``,
    `Te recordaremos 24h antes. ¡Hasta pronto, ${session.data.name}! 👋`,
  ].join('\n');
}

// ── Helpers ───────────────────────────────────────────

async function fetchAndShowSlots(phone, session) {
  let slots;
  try {
    slots = await getAvailableSlots(6, session.data.duration);
  } catch (err) {
    console.error('[calendar] getAvailableSlots error:', err);
    return `Tuvimos un problema al consultar el calendario. Por favor intenta de nuevo en unos minutos.`;
  }

  if (slots.length === 0) {
    return `No hay horarios disponibles en los próximos días. Por favor llama directamente al consultorio.`;
  }

  session.data.slots = slots;
  return `Horarios disponibles para *${session.data.name}*:\n\n${slotList(slots)}\n\n¿Cuál prefieres?`;
}

function replyAskType() {
  return [
    `Hola 👋 Bienvenido al consultorio del *${DOCTOR_NAME}*.`,
    ``,
    `¿Qué tipo de cita necesitas?`,
    ``,
    apptTypeList(),
  ].join('\n');
}

function apptTypeList() {
  return APPT_TYPES.map(t => `${t.key}️⃣ ${t.label}`).join('\n');
}

function slotList(slots) {
  return slots.map((s, i) => `${i + 1}. ${s.label}`).join('\n');
}

function isGreeting(msg) {
  return /^(hola|hi|hello|buenas|buen[oa]s|quiero|quisiera|agendar|cita|consulta|inicio|empezar|comenzar)/i.test(msg);
}

function capitalize(str) {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function touch(phone, session) {
  session.updatedAt = Date.now();
  sessions.set(phone, session);
}
