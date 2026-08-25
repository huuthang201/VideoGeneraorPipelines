import { readFile, writeFile } from 'node:fs/promises';

/**
 * A rolling publication slot, so a batch of videos goes out spaced apart rather
 * than all at once.
 *
 * One number is kept on disk: the last slot handed out. Asking for a new one
 * returns that plus the interval and moves the marker, so ten shorts rendered
 * in an afternoon publish one an hour over the following ten hours rather than
 * burying each other in the same subscriber's feed.
 *
 * ## Why the marker is caught up rather than followed
 *
 * A marker three days in the past means nobody has published for three days -
 * not that the next seventy-two uploads are due immediately. Handing out those
 * stale slots would publish everything at once, which is precisely the failure
 * the queue exists to prevent, so a marker that has fallen behind is reset to
 * now before the interval is added. At a one-hour interval this matters more
 * than it did at eight: a laptop closed over a weekend accumulates a very large
 * backlog of notional slots.
 */

export interface ScheduleState {
  /** ISO timestamp of the most recently handed-out slot. */
  nextSlot: string;
}

export interface SlotPreview {
  /** When a video scheduled right now would publish. */
  publishAt: Date;
  /** True when the stored marker had fallen into the past and was caught up. */
  wasStale: boolean;
}

/** What the next slot would be, without consuming it. */
export async function peekSlot(
  statePath: string,
  intervalHours: number,
  now: Date = new Date(),
): Promise<SlotPreview> {
  const stored = await readState(statePath);
  const marker = stored ? new Date(stored.nextSlot) : null;
  const valid = marker && !Number.isNaN(marker.getTime()) ? marker : null;
  const wasStale = valid !== null && valid.getTime() < now.getTime();
  const base = valid && !wasStale ? valid : now;

  return {
    publishAt: new Date(base.getTime() + intervalHours * 3_600_000),
    wasStale,
  };
}

/** Takes the next slot and advances the marker to it. */
export async function takeSlot(
  statePath: string,
  intervalHours: number,
  now: Date = new Date(),
): Promise<SlotPreview> {
  const preview = await peekSlot(statePath, intervalHours, now);
  await writeState(statePath, { nextSlot: preview.publishAt.toISOString() });
  return preview;
}

/**
 * Gives back a slot whose upload never happened.
 *
 * The slot is taken *before* the bytes are sent, and that order is deliberate:
 * two uploads launched together must not race for the same one. What it did not
 * have until now is the other half - nothing gave the slot back when the upload
 * then failed, so every refusal punched an interval-sized hole in the queue.
 * Ten consecutive failures once pushed this channel's marker twenty hours into
 * the future, which meant the next video that *did* upload was scheduled for
 * the day after tomorrow while nothing published in between.
 *
 * It only rewinds when the stored marker is still the one we were handed. If
 * anything else has taken a slot since, ours is no longer the last, and moving
 * the marker back would re-hand a slot already spoken for.
 */
export async function releaseSlot(
  statePath: string,
  slot: SlotPreview,
  intervalHours: number,
): Promise<boolean> {
  const stored = await readState(statePath);
  if (stored?.nextSlot !== slot.publishAt.toISOString()) return false;

  await writeState(statePath, {
    nextSlot: new Date(slot.publishAt.getTime() - intervalHours * 3_600_000).toISOString(),
  });
  return true;
}

/** Moves the marker by hand - `now` clears the queue back to the present. */
export async function resetSchedule(statePath: string, at: Date = new Date()): Promise<void> {
  await writeState(statePath, { nextSlot: at.toISOString() });
}

async function readState(statePath: string): Promise<ScheduleState | null> {
  const raw = await readFile(statePath, 'utf8').catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ScheduleState;
  } catch {
    return null;
  }
}

async function writeState(statePath: string, state: ScheduleState): Promise<void> {
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
