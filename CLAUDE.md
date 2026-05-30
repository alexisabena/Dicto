# Dicto — Project Context for Claude Code

## What is Dicto?

Dicto is a medical practice intelligence platform built for independent doctors and small clinics. It listens, transcribes, organizes, schedules, and files — turning voice into structured medical records and insurance claims automatically.

The name comes from the Latin "dictare" (to dictate). It is clean, medical, and memorable.

**Target user:** Independent doctors in Mexico (initially), particularly surgeons and specialists who deal with IMSS, ISSSTE, and private insurer claim forms.

**First customer:** A surgeon friend of the founder, willing to pay for MVP testing.

**Business model:** SaaS, ~$50–80/mo per clinic. Costs ~$24/mo to run at MVP scale. Strong margin from clinic 3 onward.

---

## The Three Core Flows (MVP)

### 1. Recording + Diarization
- Doctor opens web app on phone or desktop, presses Start
- Records sessions up to 1 hour+ (consultation, operation notes, procedure descriptions)
- Up to 5 simultaneous speakers: doctor, nurse, patient, up to 2 family members
- Auto-pause via Voice Activity Detection (VAD) or manual pause/resume button
- Audio chunked and uploaded to object storage in real time (fault-tolerant)
- Whisper (OpenAI API) transcribes each chunk in Spanish/English
- pyannote/speaker-diarization-3.1 identifies and labels speakers (SPEAKER_00–04)
- One-time voice enrollment per known speaker (doctor, nurse) for permanent labeling
- Output: timestamped, speaker-tagged Markdown file saved to patient folder

### 2. WhatsApp Scheduling
- Meta WhatsApp Business Cloud API (free tier, 1000 conversations/mo)
- Patients message the clinic number
- Node.js webhook receives message, passes to agent, sends reply
- YAML-defined conversation script: guided flow with numbered options
- Intent detection + slot filling: appointment type, preferred date, patient ID (by phone number)
- Google Calendar API (OAuth 2.0): reads availability, writes booking
- Confirmation sent to patient + doctor via WhatsApp
- Doctor can also trigger scheduling actions via voice note

### 3. Insurance Claim PDF Generation
- Guided voice Q&A: agent asks procedure questions, doctor answers by voice
- Whisper transcribes answers → Claude extracts structured fields
- Procedure record stored: diagnosis codes, findings, materials used, complications
- PDF template library: one file per insurer format (IMSS, ISSSTE, GNP, AXA, MetLife, etc.)
- Field mapping JSON: template field name → patient/procedure record field
- Auto-fill generates draft PDF for doctor review
- Doctor approves → final PDF saved to patient folder and object storage

---

## Patient File Structure

Each patient gets a folder in the file system AND an index record in Postgres.

```
patients/
└── {patient_uuid}/
    ├── perfil.md              ← demographics, blood type, allergies, history
    ├── consultas/
    │   └── 2026-05-29.md      ← per-session transcript + notes
    ├── procedimientos/
    │   └── apendicectomia-2026-04-10.md
    ├── reclamaciones/
    │   └── GNP-2026-04-15.pdf
    └── audio/
        └── 2026-05-29-raw.webm
```

Markdown files are Obsidian-compatible: YAML frontmatter + wikilinks between nodes. This gives the doctor a visual graph of the practice in Obsidian for free.

### Postgres Schema (key tables)

- **patients** — id, nombre, apellidos, fecha_nacimiento, curp, telefono, email, tipo_sangre, alergias, antecedentes
- **appointments** — id, patient_id, scheduled_at, tipo, estado, voice_note_id
- **consultations** — id, patient_id, appointment_id, fecha, motivo, exploracion, diagnostico, plan, medico
- **voice_notes** — id, patient_id, consultation_id, speaker, audio_url, transcript_es, transcript_en, extracted_fields (jsonb), recorded_at
- **operations** — id, patient_id, consultation_id, tipo_cirugia, fecha_operacion, sala, anestesia, hallazgos, complicaciones, estado
- **insurance_claims** — id, patient_id, operation_id, aseguradora, numero_poliza, folio_reclamo, campos_llenados (jsonb), estado, enviado_at
- **documents** — id, patient_id, tipo, filename, storage_url, ocr_text, extracted_data (jsonb)

---

## Technology Stack

### Infrastructure
- **Host:** Hostinger KVM 2 VPS — $8.99/mo — 2 vCPU, 8 GB RAM, 100 GB NVMe, Ubuntu 24
- **Object storage:** Hostinger Object Storage — $3.99/mo — audio files, PDFs, MD files
- **Domain:** ~$10/yr — dicto.health or similar
- **SSL:** Let's Encrypt (free, auto-renew via Certbot)
- **Reverse proxy:** Nginx

### Backend
- **Runtime:** Node.js 20 LTS (main API server, WhatsApp webhook)
- **Framework:** Fastify (lighter than Express, better for streaming)
- **Database:** PostgreSQL 16 (self-hosted on VPS)
- **ORM:** Drizzle ORM (lightweight, TypeScript-native)
- **Auth:** Single doctor login for MVP — JWT + bcrypt, no OAuth needed yet
- **File storage client:** AWS SDK v3 (compatible with Hostinger S3-compatible object storage)

### AI & Transcription
- **Transcription:** OpenAI Whisper API — $0.006/min — Spanish + English
- **Diarization:** pyannote/speaker-diarization-3.1 — self-hosted Python service on VPS — free
- **LLM for extraction/routing:** Anthropic Claude API (claude-haiku-4-5) — cheapest, fast
- **VAD:** silero-vad (Python) or browser WebRTC VAD for auto-pause

### Frontend
- **Web recorder UI:** Vanilla JS + HTML (no framework — keeps it fast on mobile)
- **Admin dashboard:** Same stack — minimal, mobile-first
- **Marketing site:** Static HTML/CSS — 3 pages (index, pricing, roadmap)

### Messaging & Calendar
- **WhatsApp:** Meta Cloud API (free tier) — webhook via Node.js
- **Calendar:** Google Calendar API v3 — OAuth 2.0
- **Conversation script:** YAML-defined dialogue tree

### PDF Generation
- **Library:** reportlab (Python) + pypdf for template overlay
- **Template storage:** PDF templates per insurer stored in object storage
- **Field mapping:** JSON config per template

---

## Cost Model

### Fixed monthly
| Service | Cost |
|---|---|
| Hostinger KVM 2 VPS | $8.99 |
| Hostinger Object Storage (100 GB) | $3.99 |
| Domain (amortized) | $0.83 |
| **Total fixed** | **$13.81** |

### Variable (usage-based)
| Service | Rate | At MVP scale (1 doctor, 20 sessions/mo) |
|---|---|---|
| OpenAI Whisper | $0.006/min | ~$7/mo |
| Anthropic Claude Haiku | ~$0.25/M tokens | ~$3/mo |
| WhatsApp Cloud API | Free up to 1000 conv/mo | $0 |
| Google Calendar API | Free | $0 |
| **Total variable** | | **~$10/mo** |

### Total at MVP: ~$24/mo
### Suggested doctor price: $50–80/mo
### Break-even: 1 paying clinic

### Volume thresholds
| Clinics | Est. cost | Suggested revenue | Margin |
|---|---|---|---|
| 1 | $24/mo | $65/mo | ~63% |
| 5 | $55/mo | $325/mo | ~83% |
| 10 | $95/mo | $650/mo | ~85% |
| 25 | $200/mo | $1,625/mo | ~88% |
| 50 | $370/mo | $3,250/mo | ~89% |

Infrastructure scales slowly (add VPS at ~20 clinics). AI costs are linear but small.

---

## Website (dicto.health or similar)

Three-page static site hosted on Vercel or Hostinger static hosting (free/included).

Style direction: Hermes Agent (nousresearch.com) aesthetic — monospace accents, clean grid, generous whitespace — but on pure white background, grey borders (#e5e5e5), black text (#111). No gradients. No color fills. Minimal serif/mono font pairing.

### Pages
1. **index.html** — Landing/lead gen. Hero with tagline, 6 feature cards, how it works, CTA to waitlist/contact
2. **pricing.html** — Interactive cost estimator: slider for number of patients + sessions/mo → live cost breakdown + recommended plan
3. **roadmap.html** — Phase-by-phase build plan, current status, what's coming

Font stack suggestion: `'DM Mono'` for headings/labels, `'DM Sans'` or `Georgia` for body.

---

## Development Roadmap

### Phase 1 — Foundation (Weeks 1–2)
- [ ] Hostinger VPS provisioning (Ubuntu 24, Nginx, Certbot, Node.js 20, Python 3.12, Postgres 16)
- [ ] Repo structure: monorepo with `/api`, `/web`, `/transcription`, `/site`
- [ ] Postgres schema migration (Drizzle)
- [ ] Patient folder structure + MD file generator
- [ ] JWT auth — single doctor login
- [ ] Object storage bucket setup + upload endpoint
- **Deliverable:** Server live, patient records creatable via API

### Phase 2 — Recording + Diarization (Weeks 3–5)
- [ ] Web recorder UI (HTML5 MediaRecorder, chunked upload, VAD auto-pause)
- [ ] Start / Pause / Resume button flow, session timer
- [ ] Audio chunk receiver endpoint (Node.js) → saves to object storage
- [ ] Python transcription service: Whisper API call per chunk
- [ ] pyannote diarization pipeline: audio → speaker segments → labeled JSON
- [ ] Speaker enrollment flow (30s voice sample per speaker)
- [ ] Transcript assembler: merge Whisper text + pyannote labels → MD file writer
- **Deliverable:** Doctor records session, gets speaker-labeled Markdown transcript

### Phase 3 — WhatsApp Scheduling (Weeks 6–7)
- [ ] Meta WhatsApp Cloud API setup (business account, webhook verification)
- [ ] Node.js webhook handler (receive, parse, reply)
- [ ] YAML conversation script loader + dialogue state machine
- [ ] Google Calendar OAuth flow + availability reader
- [ ] Booking writer: create calendar event, store appointment in Postgres
- [ ] Confirmation messages: patient + doctor WhatsApp notifications
- **Deliverable:** Patient books appointment end-to-end via WhatsApp

### Phase 4 — Insurance Claims (Weeks 8–10)
- [ ] Guided procedure voice Q&A script (agent asks, doctor answers)
- [ ] Whisper transcription + Claude field extraction → procedure record
- [ ] PDF template storage system (per insurer)
- [ ] Field mapping JSON config per template
- [ ] reportlab PDF auto-fill from procedure + patient data
- [ ] Draft review UI: doctor sees filled form, approves or edits
- [ ] Final PDF saved to patient folder
- **Deliverable:** Doctor dictates procedure → filled insurance PDF in 2 minutes

### Phase 5 — Polish + Handoff (Weeks 11–12)
- [ ] Mobile-first recorder UI refinement
- [ ] Obsidian-compatible wikilinks in all MD files
- [ ] Dashboard: today's appointments, recent transcripts, pending claims
- [ ] Automated daily backup (Postgres dump + object storage sync)
- [ ] Documentation + deployment scripts
- **Deliverable:** Demo-ready for investor, doctor can use daily

---

## Key Design Decisions

1. **MD files as the source of truth** — human-readable, Obsidian-compatible, portable. Postgres is the query index, not the primary store for notes.
2. **Self-hosted diarization** — pyannote runs on VPS CPU. Slower than GPU but free and sufficient at MVP scale (~2–3x real-time on 8GB RAM).
3. **Whisper API, not self-hosted** — Whisper large-v3 requires ~10 GB GPU VRAM. At $0.006/min it is cheaper to use the API until ~200 hours/mo of audio.
4. **Claude Haiku for extraction** — Not Sonnet or Opus. Field extraction from a transcript is a simple structured task. Haiku is 10x cheaper and fast enough.
5. **YAML dialogue trees for WhatsApp** — Non-technical operator (the doctor) can tweak conversation flows without touching code.
6. **Monorepo** — All services in one repo for easy deployment on a single VPS. Split later if scale demands it.
7. **Insurance templates as moat** — Collecting and maintaining IMSS, ISSSTE, GNP, AXA, MetLife form templates is the durable competitive advantage. Prioritize this library.

---

## What to Build First (Claude Code instructions)

Start with Phase 1. Do this in order:

1. Scaffold the monorepo structure
2. Set up Drizzle schema and migrations
3. Build the MD patient file generator
4. Create the upload endpoint for audio chunks
5. Then move to Phase 2: web recorder UI

When asking Claude Code to build, reference this file with:
`cat CLAUDE.md` to restore full context at any time.

---

## Founder Notes

- Product started as a conversation about a Hermes-style agent for a doctor friend
- The insurance template library is the business moat — start collecting formats early
- First market: independent surgeons in Mexico
- Pricing: $50–80/mo per clinic, billed monthly, no annual lock-in for MVP
- Name: **Dicto** (from "dictare" — to dictate). Domain: dicto.health preferred
- The doctor friend is the first test user AND first paying customer
- Investor conversation is in early stages — needs a clean demo by end of Phase 2

