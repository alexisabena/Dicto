/**
 * conversation.js — WhatsApp scheduling bot (state machine)
 *
 * Main menu: appointment types (1–4) + Otro tema (5)
 * Otro tema submenu: Facturas / Ubicación / Servicios / Otro
 * Free text is accepted ONLY in "Otro" — everything else is structured.
 * Medical content (symptoms, advice, media) is immediately escalated.
 */

import { getAvailableSlots, bookSlot, DOCTOR_NAME } from './calendar.js';

// ── Session store ─────────────────────────────────────
const sessions = new Map();
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;

// ── Appointment types ─────────────────────────────────
const APPT_TYPES = [
  { key: '1', label: 'Primera vez',   duration: 60 },
  { key: '2', label: 'Seguimiento',   duration: 60 },
  { key: '3', label: 'Procedimiento', duration: 60 },
  { key: '4', label: 'Urgencia',      duration: 60 },
];

// ── Info subtopics ────────────────────────────────────
const SUBTOPICS = {
  '1': 'Facturas',
  '2': 'Ubicación',
  '3': 'Servicios',
  '4': 'Otro',
};

// ── Static info content ───────────────────────────────

const INFO_FACTURAS = [
  `🧾 *Facturación*`,
  ``,
  `Ingresa al siguiente enlace y completa el formulario con los datos de tu cita y tu RFC:`,
  `🔗 https://www.drmarioleonretina.com/facturacion`,
  ``,
  `La factura se envía directamente a tu correo electrónico. Si tienes dudas adicionales escríbenos a drmarioleonretina@gmail.com`,
].join('\n');

const INFO_UBICACION = [
  `📍 *50 Doctors Torres Médicas 8, Consultorio 219*`,
  `Blvd. Lic. Luis Sánchez Pontón 616, Col. Anzures, 72530 Puebla.`,
  ``,
  `En la esquina de Blvd. Luis Sánchez Pontón y Calle 8 Sur, a dos calles de Plaza Dorada.`,
  ``,
  `🗺️ https://maps.app.goo.gl/7qBREP9UHuCptPBR6`,
].join('\n');

const INFO_SERVICIOS = [
  `👁️ *Servicios del ${DOCTOR_NAME}*`,
  `Oftalmólogo especialista en retina.`,
  ``,
  `• *Retina* — Desprendimiento, desgarros y retinopatía diabética`,
  `• *Vítreo* — Hemorragia vítrea y cuerpos flotantes`,
  `• *Mácula* — Degeneración macular y agujero macular`,
  `• *Cataratas* — Cirugía con tecnología de microincisión`,
  `• *Examen oftalmológico completo* — Valoración integral con receta actualizada`,
  `• *Urgencias* — Pérdida súbita de visión o trauma ocular`,
  ``,
  `Tecnología disponible: OCT, angiografía, vitrectomía de microincisión, láser.`,
].join('\n');

// ── Menus ─────────────────────────────────────────────

function menuMain() {
  return [
    `Hola 👋 Bienvenido al consultorio del *${DOCTOR_NAME}*.`,
    ``,
    `¿En qué te puedo ayudar?`,
    ``,
    `1️⃣ Primera vez`,
    `2️⃣ Seguimiento`,
    `3️⃣ Procedimiento`,
    `4️⃣ Urgencia`,
    `5️⃣ Otro tema`,
  ].join('\n');
}

function menuSubtopic() {
  return [
    `¿Sobre qué necesitas información?`,
    ``,
    `1️⃣ Facturas`,
    `2️⃣ Ubicación`,
    `3️⃣ Servicios`,
    `4️⃣ Otro`,
  ].join('\n');
}

function menuAfterInfo() {
  return [
    ``,
    `─────────────────`,
    `¿Puedo ayudarte en algo más?`,
    ``,
    `1️⃣ Ver otras opciones`,
    `2️⃣ Agendar una cita`,
  ].join('\n');
}

// ── Medical escalation ────────────────────────────────
const MEDICAL_PATTERN = /\b(me duele|me está doliendo|dolor (de|en|ocular)|sangr[aeo]|no veo|perdí (la )?visión|visión borrosa|visión nublada|ojo rojo|ojo inflamado|hinchad[ao]|ardor|picazón|picor|lagrimeo|se me nubló|manchas en la visión|destellos|luces en la visión|golpe en el ojo|me cayó algo|me entró algo|receta médica|medicamento|medicina|pastilla|gotas para|qué tengo|qué puede ser|es grave|es normal que|debería (preocuparme|ir urgente|tomar)|alergia ocular|infección ocular|conjuntivitis|cataratas|glaucoma|desprendimiento de retina|urgencia médica|emergencia médica|me operaron y)\b/i;

function buildEscalationAbstract(phone, text, reason) {
  return [
    `⚠️ *Derivación automática — bot Expedicta*`,
    ``,
    `📱 Paciente: +${phone}`,
    `Motivo: ${reason}`,
    `Mensaje: "_${text.slice(0, 160)}${text.length > 160 ? '...' : ''}_"`,
    ``,
    `Por favor atiende directamente a este paciente.`,
  ].join('\n');
}

// ── Main entry point ──────────────────────────────────
export async function handleMessage(phone, text) {
  const msg = text.trim();

  if (MEDICAL_PATTERN.test(msg)) {
    return {
      reply: [
        `Gracias por escribirnos. Para este tipo de consulta lo mejor es hablar directamente con el Dr. León — le haré saber para que pueda contactarte. 🩺`,
        ``,
        `Si mientras tanto quieres agendar una cita, aquí te ayudo.`,
      ].join('\n'),
      escalation: { abstract: buildEscalationAbstract(phone, msg, 'Síntoma o consulta médica') },
    };
  }

  return runStateMachine(phone, msg);
}

// ── State machine ─────────────────────────────────────
async function runStateMachine(phone, msg) {
  let session = sessions.get(phone);

  if (session && Date.now() - session.updatedAt > SESSION_TIMEOUT_MS) session = null;

  if (!session || isGreeting(msg)) {
    sessions.set(phone, { step: 'ask_type', data: {}, updatedAt: Date.now() });
    return { reply: menuMain() };
  }

  touch(phone, session);

  let result;
  switch (session.step) {
    case 'ask_type':        result = handleAskType(phone, session, msg);             break;
    case 'ask_subtopic':    result = handleAskSubtopic(phone, session, msg);         break;
    case 'ask_after_info':  result = handleAskAfterInfo(phone, session, msg);        break;
    case 'ask_other_topic': result = handleAskOtherTopic(phone, session, msg);       break;
    case 'ask_name':        result = handleAskName(phone, session, msg);             break;
    case 'ask_slot':        result = await handleAskSlot(phone, session, msg);       break;
    case 'confirm':         result = await handleConfirm(phone, session, msg);       break;
    default:
      sessions.delete(phone);
      result = menuMain();
  }

  return typeof result === 'string' ? { reply: result } : result;
}

// ── Step: main menu ───────────────────────────────────
function handleAskType(phone, session, msg) {
  const appt = APPT_TYPES.find(t => t.key === msg.trim());

  if (appt) {
    session.data.type     = appt.label;
    session.data.duration = appt.duration;
    session.step          = 'ask_name';
    return `¿Cuál es el nombre completo del paciente?`;
  }

  if (msg.trim() === '5') {
    session.step = 'ask_subtopic';
    return menuSubtopic();
  }

  return `Por favor responde con el número de tu opción:\n\n${menuMain()}`;
}

// ── Step: info submenu ────────────────────────────────
function handleAskSubtopic(phone, session, msg) {
  switch (msg.trim()) {
    case '1': // Facturas
      session.step = 'ask_after_info';
      return INFO_FACTURAS + menuAfterInfo();

    case '2': // Ubicación
      session.step = 'ask_after_info';
      return INFO_UBICACION + menuAfterInfo();

    case '3': // Servicios
      session.step = 'ask_after_info';
      return INFO_SERVICIOS + menuAfterInfo();

    case '4': // Otro — only place free text is accepted
      session.step = 'ask_other_topic';
      return `¿Sobre qué tema necesitas hablar? Escríbemelo brevemente y se lo haré saber al Dr. León.`;

    default:
      return `Por favor responde con el número de tu opción:\n\n${menuSubtopic()}`;
  }
}

// ── Step: loop after info ─────────────────────────────
function handleAskAfterInfo(phone, session, msg) {
  switch (msg.trim()) {
    case '1': // Ver otras opciones → back to subtopic menu
      session.step = 'ask_subtopic';
      return menuSubtopic();

    case '2': // Agendar una cita → back to appointment type selection
      session.data = {};
      session.step = 'ask_type';
      return [
        `¿Qué tipo de cita necesitas?`,
        ``,
        `1️⃣ Primera vez`,
        `2️⃣ Seguimiento`,
        `3️⃣ Procedimiento`,
        `4️⃣ Urgencia`,
      ].join('\n');

    default:
      return `Por favor responde *1* para ver más opciones o *2* para agendar una cita.`;
  }
}

// ── Step: free-text "Otro" ────────────────────────────
function handleAskOtherTopic(phone, session, msg) {
  if (msg.length < 3) return `¿Puedes describirme brevemente el tema?`;

  sessions.delete(phone);

  return {
    reply: `Gracias. Le haré saber al Dr. León para que pueda contactarte directamente. 👨‍⚕️`,
    escalation: {
      abstract: buildEscalationAbstract(phone, msg, 'Paciente seleccionó "Otro tema"'),
    },
  };
}

// ── Step: booking — name ──────────────────────────────
function handleAskName(phone, session, msg) {
  if (msg.length < 2) return `¿Puedes compartirme el nombre completo?`;
  session.data.name = capitalize(msg);
  session.step      = 'ask_slot';
  return fetchAndShowSlots(phone, session);
}

// ── Step: booking — slot ──────────────────────────────
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
    `📍 Torres Médicas 8, Consultorio 219 — Col. Anzures, Puebla`,
    ``,
    `¿Confirmamos? Responde *sí* o *no*`,
  ].join('\n');
}

// ── Step: booking — confirm ───────────────────────────
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
      startISO:     slot.start.toISO(),
      endISO:       slot.end.toISO(),
      patientName:  session.data.name,
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
    `📍 Torres Médicas 8, Consultorio 219`,
    `Blvd. Luis Sánchez Pontón 616, Col. Anzures, Puebla`,
    `🗺️ https://maps.app.goo.gl/7qBREP9UHuCptPBR6`,
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
    console.error('[calendar] error:', err);
    return `Tuvimos un problema al consultar el calendario. Por favor intenta en unos minutos.`;
  }

  if (slots.length === 0) {
    return `No hay horarios disponibles en los próximos días. Por favor llama directamente al consultorio.`;
  }

  session.data.slots = slots;
  return `Horarios disponibles para *${session.data.name}*:\n\n${slotList(slots)}\n\n¿Cuál prefieres?`;
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
