import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Two-audience logging (spec §29 of the first spec, §68 here).
 *
 * The terminal gets the short per-project lines a human watches a batch through;
 * runtime/logs gets one JSON object per event for after-the-fact diagnosis.
 * Both come from the same call, so a stage cannot report one thing on screen
 * and another in the file.
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

export interface LogEvent {
  level: LogLevel;
  projectId?: string;
  stage?: string;
  status?: 'started' | 'completed' | 'failed' | 'skipped';
  message: string;
  durationMs?: number;
  [key: string]: unknown;
}

export interface Logger {
  step(message: string): void;
  done(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
  debug(message: string, extra?: Record<string, unknown>): void;
  /** Returns a logger that stamps every event with this project id. */
  forProject(projectId: string): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  logDir?: string;
  projectId?: string;
  /** Suppresses terminal output; the file log still receives everything. */
  quiet?: boolean;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const logDir = options.logDir ?? path.join('runtime', 'logs');
  const projectId = options.projectId;
  const quiet = options.quiet ?? false;

  const write = (event: LogEvent) => {
    if (LEVEL_ORDER[event.level] < LEVEL_ORDER[level]) return;

    if (!quiet) {
      const prefix = event.projectId ? `[${event.projectId}] ` : '';
      console.log(`${prefix}${event.message}`);
    }

    // Fire and forget: a full disk should degrade logging, not stop a render.
    void appendJsonLine(logDir, { timestamp: new Date().toISOString(), ...event });
  };

  const withPrefix = (symbol: string, message: string) => `${symbol} ${message}`;

  return {
    step: (message) =>
      write({ level: 'info', projectId, status: 'started', message: withPrefix('→', message) }),
    done: (message, extra) =>
      write({
        level: 'info',
        projectId,
        status: 'completed',
        message: withPrefix('✓', message),
        ...extra,
      }),
    warn: (message, extra) =>
      write({ level: 'warn', projectId, message: withPrefix('!', message), ...extra }),
    error: (message, extra) =>
      write({
        level: 'error',
        projectId,
        status: 'failed',
        message: withPrefix('✗', message),
        ...extra,
      }),
    debug: (message, extra) => write({ level: 'debug', projectId, message, ...extra }),
    forProject: (id) => createLogger({ ...options, projectId: id }),
  };
}

async function appendJsonLine(logDir: string, record: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(logDir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    await appendFile(path.join(logDir, `${day}.jsonl`), `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    // Intentionally silent - see above.
  }
}
