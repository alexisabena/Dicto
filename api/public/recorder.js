// ── State ──────────────────────────────────────────────
let mediaRecorder = null;
let audioChunks   = [];
let timerInterval = null;
let levelInterval = null;
let audioContext  = null;
let analyser      = null;
let seconds       = 0;
let fullText      = '';

// ── DOM ────────────────────────────────────────────────
const recordBtn      = document.getElementById('record-btn');
const statusEl       = document.getElementById('status');
const timerEl        = document.getElementById('timer');
const hintEl         = document.getElementById('hint');
const levelBar       = document.getElementById('level-bar');
const errorBox       = document.getElementById('error-box');
const transcriptWrap = document.getElementById('transcript-wrap');
const transcriptBody = document.getElementById('transcript-body');
const transcriptMeta = document.getElementById('transcript-meta');
const copyBtn        = document.getElementById('copy-btn');
const sessionsList   = document.getElementById('sessions-list');
const navDate        = document.getElementById('nav-date');

// ── Init ───────────────────────────────────────────────
navDate.textContent = new Date().toLocaleDateString('es-MX', {
  weekday: 'long', day: 'numeric', month: 'long'
});

loadSessions();

// ── Record button ──────────────────────────────────────
recordBtn.addEventListener('click', () => {
  if (mediaRecorder?.state === 'recording') {
    stopRecording();
  } else {
    startRecording();
  }
});

async function startRecording() {
  clearError();
  transcriptWrap.classList.remove('visible');

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch {
    showError('Microphone access denied. Please allow microphone access and try again.');
    return;
  }

  // Pick best supported format
  const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']
    .find(t => MediaRecorder.isTypeSupported(t)) ?? '';

  audioChunks   = [];
  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

  mediaRecorder.addEventListener('dataavailable', e => {
    if (e.data.size > 0) audioChunks.push(e.data);
  });

  mediaRecorder.addEventListener('stop', () => {
    stream.getTracks().forEach(t => t.stop());
    stopLevelMeter();
    processRecording();
  });

  mediaRecorder.start(1000);  // collect a chunk every second

  // UI
  setState('recording');
  startTimer();
  startLevelMeter(stream);
}

function stopRecording() {
  mediaRecorder?.stop();
  stopTimer();
  setState('processing');
}

// ── Upload + Transcribe ────────────────────────────────
async function processRecording() {
  const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });

  if (blob.size === 0) {
    showError('Recording was empty. Please try again.');
    setState('idle');
    return;
  }

  const ext      = extensionFromMime(blob.type);
  const formData = new FormData();
  formData.append('audio', blob, `recording.${ext}`);

  let result;
  try {
    const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? `Server error ${res.status}`);
    }
    result = await res.json();
  } catch (err) {
    showError(`Transcription failed: ${err.message}`);
    setState('idle');
    return;
  }

  fullText = result.transcript;
  renderTranscript(result);
  setState('idle');
  loadSessions();
}

// ── Transcript render ──────────────────────────────────
function renderTranscript({ transcript, segments, duration, language }) {
  const dur = formatSeconds(duration);
  transcriptMeta.textContent = `${dur} · ${language?.toUpperCase() ?? 'ES'}`;

  transcriptBody.innerHTML = '';

  if (segments?.length > 0) {
    for (const seg of segments) {
      const line = document.createElement('div');
      line.className = 'segment-line';
      line.innerHTML = `
        <span class="segment-time">${formatSeconds(seg.start)}</span>
        <span class="segment-text">${escHtml(seg.text.trim())}</span>
      `;
      transcriptBody.appendChild(line);
    }
  } else {
    transcriptBody.textContent = transcript;
  }

  transcriptWrap.classList.add('visible');
  transcriptWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Sessions list ──────────────────────────────────────
async function loadSessions() {
  try {
    const res  = await fetch('/api/sessions');
    const data = await res.json();
    renderSessions(data.sessions ?? []);
  } catch {
    // silent — not critical
  }
}

function renderSessions(sessions) {
  if (sessions.length === 0) {
    sessionsList.innerHTML = '<span class="sessions-empty">No sessions yet.</span>';
    return;
  }
  sessionsList.innerHTML = '';
  for (const s of sessions.slice(0, 10)) {
    const item = document.createElement('div');
    item.className = 'session-item';
    item.innerHTML = `
      <span class="session-date">${s.date ?? s.id.slice(0, 8)}</span>
      <span class="session-dur">${s.duration ?? '–'}</span>
    `;
    item.addEventListener('click', () => loadSession(s.id));
    sessionsList.appendChild(item);
  }
}

async function loadSession(id) {
  const res  = await fetch(`/api/sessions/${id}/transcript`);
  const data = await res.json();
  const md   = data.markdown ?? '';

  // Strip frontmatter, show body
  const body = md.replace(/^---[\s\S]*?---\n/, '').trim();
  fullText = body;

  transcriptBody.innerHTML = '';
  const lines = body.split('\n\n').filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^\[(\d{2}:\d{2})\] (.+)$/s);
    if (match) {
      const el = document.createElement('div');
      el.className = 'segment-line';
      el.innerHTML = `
        <span class="segment-time">${escHtml(match[1])}</span>
        <span class="segment-text">${escHtml(match[2].trim())}</span>
      `;
      transcriptBody.appendChild(el);
    } else {
      const el = document.createElement('p');
      el.className = 'segment-text';
      el.textContent = line;
      transcriptBody.appendChild(el);
    }
  }

  transcriptMeta.textContent = id.slice(0, 8);
  transcriptWrap.classList.add('visible');
  transcriptWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Copy ───────────────────────────────────────────────
copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(fullText).catch(() => {});
  copyBtn.textContent = 'Copied!';
  setTimeout(() => { copyBtn.textContent = 'Copy text'; }, 2000);
});

// ── Timer ──────────────────────────────────────────────
function startTimer() {
  seconds = 0;
  timerEl.textContent = '00:00';
  timerInterval = setInterval(() => {
    seconds++;
    timerEl.textContent = formatSeconds(seconds);
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

// ── Level meter ────────────────────────────────────────
function startLevelMeter(stream) {
  audioContext = new AudioContext();
  analyser     = audioContext.createAnalyser();
  analyser.fftSize = 256;
  audioContext.createMediaStreamSource(stream).connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  levelInterval = setInterval(() => {
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    levelBar.style.width = Math.min(100, avg * 2.5) + '%';
  }, 80);
}

function stopLevelMeter() {
  clearInterval(levelInterval);
  levelInterval = null;
  levelBar.style.width = '0%';
  audioContext?.close();
  audioContext = null;
}

// ── UI state ───────────────────────────────────────────
function setState(state) {
  recordBtn.classList.remove('recording', 'processing');
  statusEl.classList.remove('recording', 'processing');
  timerEl.classList.remove('recording');
  recordBtn.disabled = false;

  if (state === 'recording') {
    recordBtn.classList.add('recording');
    statusEl.classList.add('recording');
    timerEl.classList.add('recording');
    statusEl.textContent = 'Recording';
    hintEl.textContent   = 'Tap to stop';
  } else if (state === 'processing') {
    recordBtn.classList.add('processing');
    statusEl.classList.add('processing');
    recordBtn.disabled   = true;
    statusEl.textContent = 'Transcribing…';
    hintEl.textContent   = 'Please wait';
  } else {
    statusEl.textContent = 'Ready to record';
    hintEl.textContent   = 'Tap to start recording';
    timerEl.textContent  = '00:00';
    seconds = 0;
  }
}

// ── Helpers ────────────────────────────────────────────
function formatSeconds(s) {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function extensionFromMime(mime) {
  if (mime.includes('mp4'))  return 'mp4';
  if (mime.includes('ogg'))  return 'ogg';
  if (mime.includes('mpeg')) return 'mp3';
  return 'webm';
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add('visible');
}

function clearError() {
  errorBox.textContent = '';
  errorBox.classList.remove('visible');
}
