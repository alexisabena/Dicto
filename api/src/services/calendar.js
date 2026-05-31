import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { DateTime, Interval } from 'luxon';

// ── Config from .env ─────────────────────────────────
const TZ             = process.env.TZ_CLINIC        || 'America/Mexico_City';
const CALENDAR_ID    = process.env.CALENDAR_ID      || 'primary';
const WORK_START     = parseInt(process.env.WORK_START_HOUR  || '9');   // 9 AM
const WORK_END       = parseInt(process.env.WORK_END_HOUR    || '19');  // 7 PM
const WORK_DAYS      = (process.env.WORK_DAYS || '1,2,3,4,5')           // Mon–Fri
                         .split(',').map(Number);
const SLOT_MIN       = parseInt(process.env.SLOT_DURATION_MIN || '60'); // appointment length
const BUFFER_MIN     = parseInt(process.env.SLOT_BUFFER_MIN   || '15'); // gap between slots
const DAYS_AHEAD     = parseInt(process.env.DAYS_AHEAD        || '7');  // how far to look
const DOCTOR_NAME    = process.env.DOCTOR_NAME || 'el médico';

// ── Auth ─────────────────────────────────────────────
function calendarClient() {
  const raw  = readFileSync(process.env.GOOGLE_CREDENTIALS_FILE, 'utf8');
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  return google.calendar({ version: 'v3', auth });
}

// ── Free slots ────────────────────────────────────────
/**
 * Returns up to `limit` available slots in the next DAYS_AHEAD days.
 * Each slot: { start: DateTime, end: DateTime, label: string }
 *
 * slotMin defaults to SLOT_MIN — pass a different value for follow-ups, surgeries, etc.
 */
export async function getAvailableSlots(limit = 6, slotMin = SLOT_MIN) {
  const cal    = calendarClient();
  const now    = DateTime.now().setZone(TZ);
  const rangeEnd = now.plus({ days: DAYS_AHEAD });

  // Fetch busy blocks
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

  // Walk through candidate slots day by day
  const available = [];
  let day = now.startOf('day');

  while (day < rangeEnd && available.length < limit) {
    // Skip non-working days
    if (!WORK_DAYS.includes(day.weekday % 7)) { // luxon: 1=Mon … 7=Sun → 7%7=0=Sun
      day = day.plus({ days: 1 });
      continue;
    }

    // Generate slots for this working day
    let slotStart = day.set({ hour: WORK_START, minute: 0, second: 0, millisecond: 0 });
    const dayEnd  = day.set({ hour: WORK_END,   minute: 0, second: 0, millisecond: 0 });

    while (slotStart.plus({ minutes: slotMin }) <= dayEnd) {
      const slotEnd = slotStart.plus({ minutes: slotMin });

      // Skip slots in the past (with 30-min buffer so doctor isn't surprised)
      if (slotEnd < now.plus({ minutes: 30 })) {
        slotStart = slotStart.plus({ minutes: slotMin + BUFFER_MIN });
        continue;
      }

      // Check against busy periods
      const conflict = busy.some(b =>
        slotStart < b.end && slotEnd > b.start
      );

      if (!conflict) {
        available.push({
          start: slotStart,
          end:   slotEnd,
          label: formatSlot(slotStart),
        });
        if (available.length >= limit) break;
      }

      slotStart = slotStart.plus({ minutes: slotMin + BUFFER_MIN });
    }

    day = day.plus({ days: 1 });
  }

  return available;
}

// ── Book a slot ───────────────────────────────────────
/**
 * Creates a Google Calendar event for the given slot.
 * Returns the created event.
 */
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
  const days = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

  const dow   = days[dt.weekday % 7];   // luxon weekday 7 = Sunday → 0
  const day   = dt.day;
  const month = months[dt.month - 1];
  const time  = dt.toFormat('h:mm a').toLowerCase().replace('am','AM').replace('pm','PM');

  return `${dow} ${day} ${month}, ${time}`;  // e.g. "lun 3 jun, 10:00 AM"
}

export { DOCTOR_NAME, TZ };
