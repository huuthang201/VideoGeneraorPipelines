import path from 'node:path';
import express from 'express';
import { configFor, contextFor, moduleFrom } from './lib/moduleContext';
import { listModules } from '../src/modules';
import { createProjectsRouter } from './routes/projects';
import { createBriefRouter } from './routes/brief';
import { createStoryboardRouter } from './routes/storyboard';
import { createPipelineRouter } from './routes/pipeline';
import { createBatchRouter } from './routes/batch';
import { createMediaRouter } from './routes/media';
import { createEventsRouter } from './routes/events';
import { createLibraryRouter } from './routes/library';
import { peekSlot } from '../src/publish/schedule';

// UI_PORT is the setting; PORT is honoured as a fallback so a supervisor that
// assigns a free port (a preview harness, a container) can start this without
// its own config.
const PORT = Number(process.env.UI_PORT ?? process.env.PORT ?? 4000);

const app = express();
app.use(express.json());

/**
 * Which pipelines this build offers, so the page can draw its switcher without
 * hard-coding either of them.
 */
app.get('/api/modules', (_req, res) => {
  res.json(
    listModules().map((m) => ({ id: m.id, label: m.label, description: m.description })),
  );
});

/*
 * Every route is scoped to a module.
 *
 * `/api/podcast/projects` and `/api/fact/projects` are different collections
 * living in different directories, and there is no unscoped form on purpose: a
 * request that forgot to say which pipeline it meant should fail, not guess.
 *
 * Most specific mounts first - Express tries each `app.use` in order and only
 * the first whose path prefix matches gets to handle the request.
 */
for (const m of listModules()) {
  const ctx = contextFor(m.id);
  app.use(`/api/${m.id}/projects/:id/brief`, createBriefRouter(ctx));
  app.use(`/api/${m.id}/projects/:id/storyboard`, createStoryboardRouter(ctx));
  app.use(`/api/${m.id}/projects/:id/pipeline`, createPipelineRouter(ctx));
  app.use(`/api/${m.id}/projects`, createProjectsRouter(ctx));
  app.use(`/api/${m.id}/batch`, createBatchRouter(ctx));
  app.use(`/api/${m.id}/events`, createEventsRouter(ctx));
  app.use(`/media/${m.id}`, createMediaRouter(ctx));
  // Podcast-only: the fact module has no library to manage.
  if (m.id === 'podcast') app.use(`/api/${m.id}/library`, createLibraryRouter(ctx));
}

/**
 * When the next scheduled upload would publish.
 *
 * A peek, never a take: the screen showing the time must not consume the slot,
 * or opening a project would push everything after it three hours later.
 */
app.get('/api/:module/schedule', async (req, res) => {
  const config = configFor(moduleFrom(req).id);
  const { publishAt, wasStale } = await peekSlot(
    config.youtube.schedulePath,
    config.youtube.scheduleIntervalHours,
  );
  res.json({
    publishAt: publishAt.toISOString(),
    intervalHours: config.youtube.scheduleIntervalHours,
    wasStale,
    // The queue only means anything if something can actually be uploaded.
    ready: Boolean(config.youtube.clientId && config.youtube.clientSecret),
  });
});

app.use(express.static(path.join(import.meta.dirname, 'public')));

// Express 5 forwards rejected promises from async handlers here automatically.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
});

app.listen(PORT, () => {
  console.log(`Video UI: http://localhost:${PORT}`);
  for (const m of listModules()) {
    console.log(`  ${m.label.padEnd(12)} jobs: ${configFor(m.id).jobsDir}`);
  }
});
