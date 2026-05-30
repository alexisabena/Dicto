import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const dataDir = process.env.DATA_DIR ?? './data';

/**
 * GET /api/sessions
 * Lists all sessions with basic metadata (date, duration if transcript exists).
 */
export async function sessionsRoute(app) {
  app.get('/sessions', async (req, reply) => {
    const sessionsDir = join(dataDir, 'sessions');
    if (!existsSync(sessionsDir)) return { sessions: [] };

    const dirs = await readdir(sessionsDir);
    const sessions = await Promise.all(
      dirs.map(async id => {
        const mdPath = join(sessionsDir, id, 'transcript.md');
        if (!existsSync(mdPath)) return { id, status: 'processing' };
        const md = await readFile(mdPath, 'utf8');
        const meta = parseFrontmatter(md);
        return { id, status: 'done', ...meta };
      })
    );

    return { sessions: sessions.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')) };
  });

  app.get('/sessions/:id/transcript', async (req, reply) => {
    const { id } = req.params;
    const mdPath = join(dataDir, 'sessions', id, 'transcript.md');
    if (!existsSync(mdPath)) {
      return reply.code(404).send({ error: 'Session not found' });
    }
    const md = await readFile(mdPath, 'utf8');
    return { sessionId: id, markdown: md };
  });
}

function parseFrontmatter(md) {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  return Object.fromEntries(
    match[1].split('\n')
      .map(line => line.split(': '))
      .filter(parts => parts.length === 2)
      .map(([k, v]) => [k.trim(), v.trim()])
  );
}
