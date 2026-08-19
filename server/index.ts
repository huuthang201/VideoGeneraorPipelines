import path from 'node:path';
import express from 'express';
import { loadConfig } from '../src/config/env';
import { projectsRouter } from './routes/projects';
import { briefRouter } from './routes/brief';
import { storyboardRouter } from './routes/storyboard';
import { pipelineRouter } from './routes/pipeline';
import { batchRouter } from './routes/batch';
import { mediaRouter } from './routes/media';
import { eventsRouter } from './routes/events';

const config = loadConfig();
const PORT = Number(process.env.UI_PORT ?? 4000);

const app = express();
app.use(express.json());

// Most specific mounts first: Express tries each `app.use` in order and only
// the first whose path prefix matches gets to handle the request.
app.use('/api/projects/:id/brief', briefRouter);
app.use('/api/projects/:id/storyboard', storyboardRouter);
app.use('/api/projects/:id/pipeline', pipelineRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/batch', batchRouter);
app.use('/api/events', eventsRouter);
app.use('/media', mediaRouter);

app.use(express.static(path.join(import.meta.dirname, 'public')));

// Express 5 forwards rejected promises from async handlers here automatically.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
});

app.listen(PORT, () => {
  console.log(`Video UI: http://localhost:${PORT}  (jobs: ${config.jobsDir})`);
});
