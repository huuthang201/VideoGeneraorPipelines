import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { CheckIcon, Loader2Icon, XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A button that answers two questions without being asked.
 *
 * *Did my click land?* - the press itself. Everything here is one click away
 * from a job that takes minutes, and a button that looks identical a moment
 * after being pressed invites a second press. `active:scale` is the cheapest
 * honest answer: it is instant, it costs no state, and it happens even when the
 * handler does nothing at all.
 *
 * *Is it still going?* - the work. A handler that returns a promise is asking
 * to be waited on, so the button waits: it spins, refuses further clicks, and
 * flashes a tick when the promise settles. A handler that returns nothing has
 * already finished by the time it returns, and spinning at that would be a lie.
 * That single rule is why call sites only had to stop writing `void` in front
 * of their handlers to gain the whole behaviour.
 *
 * What it deliberately does *not* cover is a job that outlives the request that
 * started it. Pressing "Bắt đầu" resolves in a few hundred milliseconds; the
 * pipeline it kicked off runs for minutes. That state belongs to the run, comes
 * back over the event stream, and is drawn by the pipeline row - a button
 * cannot know it and should not pretend to.
 */

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
        outline: 'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ActionPhase = 'idle' | 'pending' | 'done' | 'failed';

/**
 * How long the tick stays up once the work is done.
 *
 * Long enough to be caught out of the corner of an eye while looking somewhere
 * else on the page, short enough that it has cleared before anyone wants to
 * press the same button again.
 */
const FLASH_MS = 1400;

const isThenable = (value: unknown): value is Promise<unknown> =>
  typeof (value as { then?: unknown } | null | undefined)?.then === 'function';

/**
 * The pending → done → idle cycle, on its own so controls that are not buttons
 * can borrow it. The auto-publish dropdown writes to the server the moment it
 * changes and used to do so in complete silence; it uses this.
 */
export function useActionPhase() {
  const [phase, setPhase] = React.useState<ActionPhase>('idle');

  /*
   * A control often disappears along with the work it did - deleting a project
   * closes the dialog the delete button was in - so both the timer and the
   * promise have to check there is still something on screen to update.
   */
  const alive = React.useRef(true);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(() => {
    // Re-armed on the way in, not just cleared on the way out. StrictMode runs
    // an effect, tears it down and runs it again, so a flag only ever set false
    // by the cleanup would leave every button in `npm run ui:dev` permanently
    // convinced it had been unmounted - and silent.
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  const settle = React.useCallback((next: ActionPhase) => {
    if (!alive.current) return;
    clearTimeout(timer.current);
    setPhase(next);
    timer.current = setTimeout(() => {
      if (alive.current) setPhase('idle');
    }, FLASH_MS);
  }, []);

  /**
   * Follows `result` if it is a promise, and reports whether it did.
   *
   * The rejection branch is handled here rather than rethrown: every caller in
   * this app already catches its own failure and raises a toast, so rethrowing
   * would only add an unhandled rejection to the console beside a message the
   * user has already read.
   */
  const track = React.useCallback(
    (result: unknown): boolean => {
      if (!isThenable(result)) return false;
      clearTimeout(timer.current);
      setPhase('pending');
      void result.then(
        () => settle('done'),
        () => settle('failed'),
      );
      return true;
    },
    [settle],
  );

  return { phase, track };
}

/**
 * The spinner, tick or cross itself.
 *
 * Drawn in `currentColor` on purpose. Inside a button the surface may be any of
 * six variants - a success green on the primary blue would be two mid-tones on
 * top of each other - so the colour of the *state* is carried by the ring
 * around the button, and the mark just has to stay legible.
 */
export function ActionMark({ phase, className }: { phase: ActionPhase; className?: string }) {
  if (phase === 'idle') return null;
  const Icon = phase === 'pending' ? Loader2Icon : phase === 'done' ? CheckIcon : XIcon;
  return (
    <span className={cn('inline-flex shrink-0', className)} aria-hidden>
      <Icon className={cn('size-4', phase === 'pending' && 'animate-spin')} />
    </span>
  );
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  onClick,
  disabled,
  children,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const { phase, track } = useActionPhase();

  // Slot demands exactly one child, so a button rendered as something else
  // keeps the press feedback (it is only a class) and forgoes the mark.
  if (asChild) {
    return (
      <Slot
        className={cn(buttonVariants({ variant, size, className }))}
        onClick={onClick}
        {...props}
      >
        {children}
      </Slot>
    );
  }

  return (
    <button
      data-phase={phase}
      onClick={(event) => track(onClick?.(event))}
      disabled={disabled || phase === 'pending'}
      aria-busy={phase === 'pending' || undefined}
      className={cn(
        buttonVariants({ variant, size, className }),
        // The button's own leading icon steps aside for the mark, rather than
        // the mark being added alongside it: a play triangle next to a spinner
        // reads as two states at once. The label is left alone, because
        // "Đang tải lên" beside a spinner says more than a spinner does.
        phase !== 'idle' && '[&>svg]:hidden',
        phase === 'done' && 'ring-success/60 ring-2',
        phase === 'failed' && 'ring-destructive/60 ring-2',
      )}
      {...props}
    >
      {/* Wrapped in a span rather than dropped in bare, so `has-[>svg]` still
          sees only what the caller passed. A text-only button must not lose
          4px of padding on each side for a second just because it is busy. */}
      <ActionMark phase={phase} />
      {children}
    </button>
  );
}

export { Button, buttonVariants };
