import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { v4 as uuid } from 'uuid';
import { transcribeAudio } from '../services/whisper.js';
import { formatTranscript } from '../services/markdown.js';

const dataDir = process.env.DATA_DIR ?? './data';

/**
 * POST /api/transcribe
 * Body: multipart with field "audio" (audio file, max 30 MB)
 * Returns: { sessionId, transcript, duration, segments }
 */
export async function transcribeRoute(app) {
  app.post('/transcribe', async (req, reply) => {
    const data = await req.file();
    if (!data) {
      return reply.code(400).send({ error: 'No audio file in request' });
    }

    const buffer = await data.toBuffer();
    if (buffer.length === 0) {
      return reply.code(400).send({ error: 'Empty audio file' });
    }

    const sessionId = uuid();
    const today     = new Date().toISOString().slice(0, 10);
    const sessionDir = join(dataDir, 'sessions', sessionId);

    await mkdir(sessionDir, { recursive: true });

    // Save raw audio for reference
    const ext      = extensionFromMime(data.mimetype) ?? 'webm';
    const audioPath = join(sessionDir, `audio.${ext}`);
    await writeFile(audioPath, buffer);

    let whisperResult;
    try {
      whisperResult = await transcribeAudio(buffer, `audio.${ext}`);
    } catch (err) {
      req.log.error({ err }, 'Whisper API error');
      return reply.code(502).send({ error: 'Transcription service unavailable' });
    }

    const md = formatTranscript({
      ...whisperResult,
      sessionId,
      date: today,
    });

    const mdPath = join(sessionDir, 'transcript.md');
    await writeFile(mdPath, md, 'utf8');

    return {
      sessionId,
      duration:  whisperResult.duration,
      language:  whisperResult.language,
      segments:  whisperResult.segments,
      transcript: whisperResult.text,
      markdown:  md,
    };
  });
}

function extensionFromMime(mime) {
  const map = {
    'audio/webm':  'webm',
    'audio/mp4':   'mp4',
    'audio/mpeg':  'mp3',
    'audio/ogg':   'ogg',
    'audio/wav':   'wav',
    'audio/x-m4a': 'm4a',
  };
  return map[mime?.split(';')[0].trim()];
}
