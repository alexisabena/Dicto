# Expedicta — Mexican Regulatory Compliance Notes

> These requirements apply primarily to the **recording, transcription, and medical file management** features (Phase 2+).
> The WhatsApp scheduling bot is intentionally scoped to avoid triggering these — it does NOT handle clinical data.
> Revisit this document before building any feature that stores, transmits, or processes patient health information.

---

## Applicable frameworks

### LFPDPPP — Ley Federal de Protección de Datos Personales en Posesión de Particulares
**Applies to:** Any storage or processing of patient health data (sensitive personal data)
**Key requirements:**
- Express written consent before collecting sensitive health data
- Technical, physical, and administrative safeguards
- INAI registration if processing health data at scale
- **Risk of non-compliance:** Fines up to 25 million pesos + INAI audit

**Impact on Expedicta:**
- Transcriptions of medical consultations = sensitive health data
- Patient profiles (diagnoses, allergies, history) = sensitive health data
- Audio recordings = sensitive health data
- Required: consent form at patient onboarding, encryption at rest and in transit

---

### NOM-004-SSA3-2012 — Expediente Clínico
**Applies to:** Clinical records created by licensed medical practitioners
**Key requirements:**
- Structured, standardized clinical record format
- Minimum 5-year retention
- Records must be legally defensible in malpractice cases
- Unstructured WhatsApp conversations do NOT qualify as clinical records

**Impact on Expedicta:**
- Markdown transcripts must follow NOM-004 structure to count as clinical records
- Cannot rely on WhatsApp chat history as clinical documentation
- The doctor's signed/approved notes must be the canonical record, not raw transcripts

---

### NOM-024-SSA3-2012 — Sistemas de Información de Registro Electrónico para la Salud (EHR)
**Applies to:** Electronic health record systems
**Key requirements:**
- Mandatory encryption standards for EHR data
- Audit trail: who accessed what, when
- Interoperability with SINBA (Sistema Nacional de Información Básica en Materia de Salud)
- Strict database architecture standards

**Impact on Expedicta:**
- If Expedicta positions itself as an EHR system, full NOM-024 compliance required
- MVP positioning: clinical notes assistant, not a certified EHR — lowers compliance burden
- Long term: encryption at rest (AES-256), access logs, audit trail per record

---

### COFEPRIS — Comisión Federal para la Protección contra Riesgos Sanitarios
**Applies to:** Medical prescriptions and pharmaceutical communications
**Key requirements:**
- Prescriptions must follow specific formatting and secure documentation
- Prescribing via WhatsApp text is illegal
- Encourages unsafe self-medication → voids legal protections for the physician

**Impact on Expedicta:**
- Bot must NEVER process, display, or relay prescription information
- Hard stop: any message mentioning medications → escalate to doctor immediately
- No feature should allow the doctor to send prescriptions via the WhatsApp channel

---

## WhatsApp bot — compliance posture (current)

| Risk | Mitigation in place |
|---|---|
| Bot interprets symptoms | Hard stop: escalates to doctor, no AI response |
| Bot gives medical advice | Scripted flow only — no AI in conversation |
| Patient data stored in WhatsApp | We don't store WhatsApp conversation history |
| Prescription via bot | Blocked by scope — bot only books appointments |
| Consent for data collection | ⚠️ Pending — need consent message at first contact |

### Pending compliance task (low urgency, before scale):
Add a first-contact consent message:
> "Al usar este servicio aceptas que tus datos de contacto serán usados exclusivamente para gestionar tu cita con el Dr. Mario León, conforme a nuestra política de privacidad."

---

## Priority order for compliance investment

1. **Now:** Keep bot scoped (appointments only) — already done ✅
2. **Before storing any clinical data:** LFPDPPP consent + encryption at rest
3. **Before going multi-clinic:** INAI registration assessment
4. **If positioning as EHR:** NOM-024 full compliance audit (expensive — defer)
5. **Never:** Allow prescriptions or diagnoses through any automated channel
