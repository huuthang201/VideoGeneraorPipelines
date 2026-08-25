import { useEffect, useRef } from 'react';
import { apiPath, type ProjectSummary, type RunState } from './api';

/**
 * The server's live feed, as one subscription for the whole app.
 *
 * One `EventSource` per tab rather than one per component: a browser allows
 * only six connections to an origin, and a grid of twenty project cards each
 * opening its own stream would exhaust that and then silently stop updating -
 * the failure mode being "the screen is stale" rather than anything that looks
 * like an error.
 *
 * The stream is already filtered to this module by the server, so nothing here
 * has to check.
 */

export interface RunEvent {
  projectId: string;
  run: RunState;
  summary: ProjectSummary | null;
}

export interface DoneEvent {
  projectId: string;
  kind: string;
  ok: boolean;
  message: string;
  summary: ProjectSummary | null;
}

export interface UpdateEvent {
  projectId: string;
  summary: ProjectSummary;
  progress: { renderedFrames: number; totalFrames: number } | null;
}

interface Handlers {
  onRun?: (e: RunEvent) => void;
  onUpdate?: (e: UpdateEvent) => void;
  onDone?: (e: DoneEvent) => void;
}

export function useEvents(handlers: Handlers): void {
  // Held in a ref so a re-render with new closures does not tear down and
  // rebuild the connection - reconnecting on every keystroke in a text box
  // would drop events in the gap.
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const source = new EventSource(apiPath('/events'));

    const on = <T,>(name: string, pick: (h: Handlers) => ((e: T) => void) | undefined) => {
      const listener = (event: MessageEvent<string>) => {
        try {
          pick(ref.current)?.(JSON.parse(event.data) as T);
        } catch {
          // A malformed frame is not worth tearing the stream down for.
        }
      };
      source.addEventListener(name, listener as EventListener);
      return () => source.removeEventListener(name, listener as EventListener);
    };

    const offs = [
      on<RunEvent>('run', (h) => h.onRun),
      on<UpdateEvent>('update', (h) => h.onUpdate),
      on<DoneEvent>('done', (h) => h.onDone),
    ];

    return () => {
      offs.forEach((off) => off());
      source.close();
    };
  }, []);
}
