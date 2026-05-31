import { getAvailableSlots, bookSlot, DOCTOR_NAME } from './calendar.js';

/**
 * In-memory conversation state per phone number.
 * In production this would be Redis or a DB table.
 * { [phone]: { step, data, slots, updatedAt } }
 */
const sessions = new Map();

const STEP_TIMEOUT_MS = 15 * 60 * 1000; // 15 min idle resets the conversation

// ── Appointment types ────────────────────────────────
const APPT_TYPES = [
  { key: '1', label: 'Primera consulta',  duration: 60 },
  { key: '2', label: 'Seguimiento',       duration: 30 },
  { key: '3', label: 'Procedimiento',     duration: 90 },
];

// ── Main entry point ──────────────────────────────────
/**
 * Handle an incoming WhatsApp message.
 * Returns the reply string to send back.
 */
export async function handleMessage(phone, text) {
  const msg = text.trim();

  let session = sessions.get(phone);

  // Reset stale sessions
  if (session && Date.now() - session.updatedAt > STEP_TIMEOUT_MS) {
    session = null;
  }

  // Greeting keywords start a new booking flow
  if (!session || isGreeting(msg)) {
    sessions.set(phone, { step: 'ask_type', data: {}, updatedAt: Date.now() });
    return replyAskType();
  }

  touch(phone, session);

  switch (session.step) {
    case 'ask_type':    return handleAskType(phone, session, msg);
    case 'ask_name':    return handleAskName(phone, session, msg);
    case 'ask_slot':    return handleAskSlot(phone, session, msg);
    case 'confirm':     return handleConfirm(phone, session, msg);
    default:
      sessions.delete(phone);
      return replyAskType();
  }
}

// ── Step handlers ─────────────────────────────────────

function handleAskType(phone, session, msg) {
  const choice = APPT_TYPES.find(t => t.key === msg);
  if (!choice) {
    return `Por favor responde con el número de la opción:\n${apptTypeList()}`;
  }
  session.data.type     = choice.label;
  session.data.duration = choice.duration;
  session.step = 'ask_name';
  return `¿Cuál es tu nombre completo?`;
}

function handleAskName(phone, session, msg) {
  if (msg.length < 2) return '¿Puedes compartirme tu nombre completo?';
  session.data.name = capitalize(msg);
  session.step = 'ask_slot';
  return fetchAndShowSlots(phone, session);
}

async function handleAskSlot(phone, session, msg) {
  const idx = parseInt(msg) - 1;
  const slots = session.data.slots || [];

  if (isNaN(idx) || idx < 0 || idx >= slots.length) {
    return `Por favor elige un número del 1 al ${slots.length}.\n\n${slotList(slots)}`;
  }

  const chosen = slots[idx];
  session.data.chosenSlot = chosen;
  session.step = 'confirm';

  return [
    `Perfecto, ${session.data.name} 👍`,
    ``,
    `Confirma tu cita:`,
    `📅 ${chosen.label}`,
    `🏥 ${DOCTOR_NAME}`,
    `📋 ${session.data.type}`,
    ``,
    `¿Confirmas? Responde *sí* o *no*`,
  ].join('\n');
}

async function handleConfirm(phone, session, msg) {
  const yes = /^(s[ií]|yes|ok|dale|va|confirmo|confirm)/i.test(msg);
  const no  = /^(no|cancel|nope)/i.test(msg);

  if (!yes && !no) {
    return `Responde *sí* para confirmar o *no* para cancelar.`;
  }

  if (no) {
    session.step = 'ask_slot';
    return `Sin problema. Elige otro horario:\n\n${slotList(session.data.slots)}`;
  }

  // Book it
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
    console.error('Calendar booking error:', err);
    return `Tuvimos un problema al agendar. Por favor llama directamente a la clínica.`;
  }

  sessions.delete(phone);

  return [
    `✅ *Cita confirmada*`,
    ``,
    `📅 ${slot.label}`,
    `🏥 ${DOCTOR_NAME}`,
    `📋 ${session.data.type}`,
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
    console.error('Calendar error:', err);
    return `Tuvimos un problema consultando el calendario. Intenta de nuevo en unos minutos.`;
  }

  if (slots.length === 0) {
    return `No hay horarios disponibles en los próximos días. Por favor llama directamente a la clínica.`;
  }

  session.data.slots = slots;
  return `Hola ${session.data.name} 😊 Estos son los horarios disponibles:\n\n${slotList(slots)}\n\n¿Cuál prefieres?`;
}

function replyAskType() {
  return [
    `Hola 👋 Soy el asistente de ${DOCTOR_NAME}.`,
    ``,
    `¿Qué tipo de consulta necesitas?`,
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
  return /^(hola|hi|hello|buenas|buen[oa]s|quiero|quisiera|agendar|cita|consulta)/i.test(msg);
}

function capitalize(str) {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function touch(phone, session) {
  session.updatedAt = Date.now();
  sessions.set(phone, session);
}
