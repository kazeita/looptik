import express from 'express';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const libraryFile = join(root, 'data', 'library.json');
const app = express();

app.use(express.json({ limit: '10mb' }));

app.get('/api/library', async (_request, response) => {
  try {
    response.json(JSON.parse(await readFile(libraryFile, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return response.json([]);
    response.status(500).json({ error: 'Could not read the shared library.' });
  }
});

app.put('/api/library', async (request, response) => {
  const videos = request.body?.videos;
  if (!Array.isArray(videos) || !videos.length || !videos.every((video) => /^\d+$/.test(video.id) && typeof video.url === 'string' && video.url.includes('tiktok.com'))) {
    return response.status(400).json({ error: 'Expected a non-empty list of TikTok videos.' });
  }
  await mkdir(dirname(libraryFile), { recursive: true });
  await writeFile(libraryFile, JSON.stringify(videos, null, 2), 'utf8');
  response.status(204).end();
});

app.use(express.static(join(root, 'dist')));
app.get('{*path}', (_request, response) => response.sendFile(join(root, 'dist', 'index.html')));

const port = process.env.PORT || 4173;
app.listen(port, () => console.log(`LoopTik is running at http://localhost:${port}`));
