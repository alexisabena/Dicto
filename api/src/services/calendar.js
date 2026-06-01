import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { DateTime } from 'luxon';

// ── Config from .env ─────────────────────────────────
const TZ           = process.env.TZ_CLINIC         || 'America/Mexico_City';
const CALENDAR_ID  = process.env.CALENDAR_ID        || 'primary';
const WORK_START   = parseInt(process.env.WORK_START_HOUR   || '8');   // 8 AM
const LUNCH_START  = parseInt(process.env.LUNCH_START_HOUR  || '12');  // 12 PM
const LUNCH_END    = parseInt(process.env.LUNCH_END_HOUR    || '13');  // 1 PM
const WORK_END     = parseInt(process.env.WORK_END_HOUR     || '19');  // 7 PM
const SAT_END      = parseInt(process.env.SAT_END_HOUR      || '12');  // Sat ends at noon
const WORK_DAYS    = (process.env.WORK_DAYS || '1,2,3,4,5,6')          // Mon–Sat
                       .split(',').map(Number);
const SLOT_MIN     = parseInt(process.env.SLOT_DURATION_MIN || '60');
const BUFFER_MIN   = parseInt(process.env.SLOT_BUFFER_MIN   || '0');
const DAYS_AHEAD   = parseInt(process.env.DAYS_AHEAD        || '30');
const DOCTOR_NAME  = process.env.DOCTOR_NAME || 'el médico';

// ── Auth ─────────────────────────────────────────────
function calendarClient() {
  const raw  = readFileSync(process.env.GOOGLE_CREDENTIALS_FILE, 'utf8');
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  return google.calendar({ version: 'v3', auth });
}

// ── Time blocks per day ───────────────────────────────
// Luxon weekday: 1=Mon … 6=Sat, 7=Sun
function getDayBlocks(day) {
  const set = (h) => day.set({ hour: h, minute: 0, second: 0, millisecond: 0 });

  if (day.weekday === 6) {
    // Saturday: morning only
    return [{ start: set(WORK_START), end: set(SAT_END) }];
  }

  // Mon–Fri: morning + afternoon (lunch break excluded)
  return [
    { start: set(WORK_START), end: set(LUNCH_START) },
    { start: set(LUNCH_END),  end: set(WORK_END)    },
  ];
}

// ── Free slots ────────────────────────────────────────
/**
 * Returns up to `limit` available slots within the next DAYS_AHEAD days.
 * Each slot: { start: DateTime, end: DateTime, label: string }
 */
export async function getAvailableSlots(limit = 6, slotMin = SLOT_MIN) {
  const cal      = calendarClient();
  const now      = DateTime.now().setZone(TZ);
  const rangeEnd = now.plus({ days: DAYS_AHEAD });

  const res = await cal.freebusy.query({
    requestBody: {
      timeMin:  now.toISO(),
      timeMax:  rangeEnd.toISO(),
      timeZone: TZ,
      items:    [{ id: CALENDAR_ID }],
    },
  });

  const busy = (res.data.calendars[CALENDAR_ID]?.busy ?? []).map(b => ({
    start: DateTime.fromISO(b.start, { zone: TZ }),
    end:   DateTime.fromISO(b.end,   { zone: TZ }),
  }));

  const available = [];
  let day = now.startOf('day');

  while (day < rangeEnd && available.length < limit) {
    if (!WORK_DAYS.includes(day.weekday)) { // Luxon: 1=Mon … 6=Sat, 7=Sun
      day = day.plus({ days: 1 });
      continue;
    }

    for (const block of getDayBlocks(day)) {
      let slotStart = block.start;

      while (slotStart.plus({ minutes: slotMin }) <= block.end) {
        const slotEnd = slotStart.plus({ minutes: slotMin });

        // Skip slots already in the past (30-min lead time)
        if (slotEnd < now.plus({ minutes: 30 })) {
          slotStart = slotStart.plus({ minutes: slotMin + BUFFER_MIN });
          continue;
        }

        const conflict = busy.some(b => slotStart < b.end && slotEnd > b.start);

        if (!conflict) {
          available.push({ start: slotStart, end: slotEnd, label: formatSlot(slotStart) });
          if (available.length >= limit) break;
        }

        slotStart = slotStart.plus({ minutes: slotMin + BUFFER_MIN });
      }

      if (available.length >= limit) break;
    }

    day = day.plus({ days: 1 });
  }

  return available;
}

// ── Book a slot ───────────────────────────────────────
export async function bookSlot({ startISO, endISO, patientName, patientPhone, type = 'Consulta' }) {
  const cal = calendarClient();

  const event = await cal.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary:     `${type} — ${patientName}`,
      description: `Paciente: ${patientName}\nTel: ${patientPhone}\nAgendado vía Expedicta`,
      start: { dateTime: startISO, timeZone: TZ },
      end:   { dateTime: endISO,   timeZone: TZ },
    },
  });

  return event.data;
}

// ── Helpers ───────────────────────────────────────────
function formatSlot(dt) {
  // Luxon weekday: 1=Mon … 7=Sun; index offset by 1
  const days   = ['', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

  const time = dt.toFormat('h:mm a').toLowerCase().replace('am','AM').replace('pm','PM');
  return `${days[dt.weekday]} ${dt.day} ${months[dt.month - 1]}, ${time}`;
}

export { DOCTOR_NAME, TZ };
