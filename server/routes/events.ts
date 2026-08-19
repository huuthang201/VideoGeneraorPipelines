import { Router } from 'express';
import { events } from '../lib/pipelineRunner';

/** One SSE stream, shared by every connected browser tab. */
export const eventsRouter = Router();

eventsRouter.get('/', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');

  const send = (event: string) => (payload: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  const onUpdate = send('update');
  const onDone = send('done');
  const onBatchDone = send('batch-done');

  events.on('update', onUpdate);
  events.on('done', onDone);
  events.on('batch-done', onBatchDone);

  // Keeps intermediary proxies/browsers from timing out an idle connection.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    events.off('update', onUpdate);
    events.off('done', onDone);
    events.off('batch-done', onBatchDone);
  });
});
