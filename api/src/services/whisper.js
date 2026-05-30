import OpenAI from 'openai';
import { toFile } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Transcribe audio buffer via OpenAI Whisper.
 * Returns { text, segments, duration, language }
 * where segments = [{ start, end, text }]
 */
export async function transcribeAudio(buffer, filename) {
  const file = await toFile(buffer, filename, { type: detectMime(filename) });

  const result = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'es',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  });

  return {
    text:     result.text,
    segments: result.segments ?? [],
    duration: result.duration ?? 0,
    language: result.language ?? 'es',
  };
}

function detectMime(filename) {
  if (filename.endsWith('.mp4') || filename.endsWith('.m4a')) return 'audio/mp4';
  if (filename.endsWith('.ogg')) return 'audio/ogg';
  if (filename.endsWith('.wav')) return 'audio/wav';
  if (filename.endsWith('.mp3')) return 'audio/mpeg';
  return 'audio/webm';
}
