# Expedicta — Service Ownership & Transfer Plan

> **Estado actual:** Todos los servicios de infraestructura y APIs corren bajo cuentas de **Alexis Abena** (`alexisfy@gmail.com`) como parte del desarrollo del MVP para el Dr. Mario León.
>
> Este documento debe actualizarse cada vez que un servicio cambie de titular, y debe revisarse antes de cualquier acuerdo comercial formal con el doctor.

---

## Servicios activos

| Servicio | Titular actual | Cuenta | Costo estimado/mes | Criticidad |
|---|---|---|---|---|
| Hostinger KVM 2 VPS | Alexis | hostinger.com | $8.99 | 🔴 Alta — servidor principal |
| Hostinger Object Storage | Alexis | hostinger.com | $3.99 | 🟡 Media — audio y archivos |
| Anthropic API (Claude Haiku) | Alexis | console.anthropic.com | ~$3 | 🔴 Alta — bot WhatsApp |
| OpenAI Whisper API | Alexis | platform.openai.com | ~$7 | 🔴 Alta — transcripciones |
| Kapso.ai (WhatsApp Business) | Alexis | app.kapso.ai | Variable | 🔴 Alta — canal WhatsApp |
| Google Calendar API | Mario | cuenta Google del doctor | $0 | 🔴 Alta — agendamiento |
| Dominio expedicta.com | Por confirmar | — | ~$0.83 | 🔴 Alta — identidad |
| GitHub repo (alexisabena/expedicta) | Alexis | github.com/alexisabena | $0 | 🟡 Media — código fuente |

**Total mensual corriendo bajo cuenta de Alexis: ~$24/mo** (sin contar uso variable de AI)

---

## Plan de transferencia por servicio

### 1. Anthropic API — `ANTHROPIC_API_KEY`
**Dificultad:** 🟢 Fácil (10 min)
1. Mario crea cuenta en [console.anthropic.com](https://console.anthropic.com)
2. Agrega método de pago
3. Genera una API key
4. Alexis actualiza `ANTHROPIC_API_KEY` en `/opt/expedicta/api/.env` y reinicia el servicio
5. Alexis borra la key de su cuenta

**Riesgo si no se transfiere:** Bot de WhatsApp deja de responder si Alexis no renueva créditos.

---

### 2. OpenAI Whisper API — `OPENAI_API_KEY`
**Dificultad:** 🟢 Fácil (10 min)
1. Mario crea cuenta en [platform.openai.com](https://platform.openai.com)
2. Agrega método de pago
3. Genera API key
4. Alexis actualiza `OPENAI_API_KEY` en `.env` y reinicia
5. Alexis borra la key de su cuenta

**Riesgo si no se transfiere:** Transcripciones de consultas dejan de funcionar.

---

### 3. Kapso.ai — WhatsApp Business
**Dificultad:** 🟡 Media
- Si la cuenta Kapso está bajo el correo de Alexis:
  1. Invitar al Dr. León como administrador en Settings → Team
  2. Transferir ownership a su correo
  3. Actualizar método de pago
- Si la cuenta ya está bajo el correo del doctor: ✅ sin acción necesaria

**Riesgo si no se transfiere:** El número de WhatsApp del consultorio queda ligado a la cuenta de Alexis.

---

### 4. Hostinger VPS + Object Storage
**Dificultad:** 🟡 Media
**Opción A — Transferir facturación (recomendada):**
1. Mario crea cuenta en Hostinger
2. Alexis transfiere el servidor a la nueva cuenta (Hostinger tiene opción de transferencia entre cuentas)
3. Mario agrega método de pago

**Opción B — Migrar a nuevo servidor:**
1. Mario compra VPS en su cuenta
2. Alexis replica la configuración (script de deploy documentado)
3. Apunta el dominio al nuevo IP
4. Periodo de transición de 24h

**Riesgo si no se transfiere:** Alexis puede apagar el servidor (intencional o por falta de pago).

---

### 5. Dominio (expedicta.com o equivalente)
**Dificultad:** 🟢 Fácil
- Registrar el dominio directamente a nombre del doctor o transferirlo con unlock + auth code.
- **Recomendación:** Registrar desde el inicio bajo la cuenta de Mario para evitar este paso.

---

### 6. GitHub repo
**Dificultad:** 🟢 Fácil
1. Mario crea cuenta GitHub
2. Alexis transfiere el repo: Settings → Transfer ownership
3. El código pasa a `mariolean/expedicta` o similar
4. Actualizar remote en el servidor: `git remote set-url origin https://github.com/nuevo/expedicta.git`

**Nota:** El historial de commits, PRs y todo el código se preserva intacto en la transferencia.

---

## Checklist de transferencia completa

Para cuando el doctor esté listo para tomar control total:

- [ ] Anthropic API key transferida
- [ ] OpenAI API key transferida
- [ ] Kapso ownership transferida
- [ ] Hostinger VPS transferido o migrado
- [ ] Hostinger Object Storage transferido
- [ ] Dominio bajo cuenta del doctor
- [ ] GitHub repo transferido
- [ ] Google Calendar credentials siguen siendo las del doctor ✅ (ya son suyas)
- [ ] `.env` actualizado y servicio reiniciado
- [ ] Verificar que el bot y la grabación siguen funcionando post-transferencia
- [ ] Alexis borra todas las keys antiguas de sus cuentas

---

## Notas

- La transferencia puede hacerse **servicio por servicio** sin downtime — no hay que hacerlo todo de una vez.
- El orden recomendado: primero las APIs (más riesgo operativo), luego infraestructura (más lento).
- Google Calendar ya es del doctor. No requiere acción.
- Este documento vive en el repo. Actualízalo cuando algo cambie.
