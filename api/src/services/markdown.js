/**
 * Format a Whisper transcription result into a Markdown file.
 * Segments become timestamped lines; frontmatter captures metadata.
 */
export function formatTranscript({ text, segments, duration, language, sessionId, date }) {
  const dur = formatDuration(duration);
  const frontmatter = [
    '---',
    `session_id: ${sessionId}`,
    `date: ${date}`,
    `duration: ${dur}`,
    `language: ${language}`,
    `words: ${wordCount(text)}`,
    '---',
    '',
  ].join('\n');

  if (segments.length === 0) {
    return frontmatter + text;
  }

  const body = segments
    .map(s => `[${formatDuration(s.start)}] ${s.text.trim()}`)
    .join('\n\n');

  return frontmatter + body;
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
