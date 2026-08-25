import { Router } from 'express';
import type { ModuleContext } from '../lib/moduleContext';
import { events } from '../lib/pipelineRunner';

/** One SSE stream, shared by every connected browser tab. */
/**
 * One router per module.
 *
 * A factory rather than a singleton because the server hosts both pipelines at
 * once, and each needs its own `config` - different job directory, different
 * cache, different YouTube credentials. Mounting the same instance under both
 * prefixes would have given whichever module loaded first to both.
 */
export function createEventsRouter(ctx: ModuleContext) {
  const { config, module } = ctx;
  const router = Router();

router.get('/', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');

  /**
   * Only this module's events reach this stream.
   *
   * The emitter is one object shared by both pipelines - the upload queue spans
   * them deliberately - so without this filter a podcast tab would redraw its
   * cards from a fact short's progress. Every payload already names its module;
   * this drops the ones that are not ours rather than making each screen
   * remember to check.
   */
  const send = (event: string) => (payload: unknown) => {
    if ((payload as { module?: string } | null)?.module !== module.id) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  const onUpdate = send('update');
  const onDone = send('done');
  const onRun = send('run');
  const onBatchDone = send('batch-done');

  events.on('update', onUpdate);
  events.on('done', onDone);
  events.on('run', onRun);
  events.on('batch-done', onBatchDone);

  // Keeps intermediary proxies/browsers from timing out an idle connection.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    events.off('update', onUpdate);
    events.off('done', onDone);
    events.off('run', onRun);
    events.off('batch-done', onBatchDone);
  });
});

  return router;
}
