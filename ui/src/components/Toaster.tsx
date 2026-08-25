import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2Icon, InfoIcon, XCircleIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Transient messages, bottom-right.
 *
 * Small enough not to warrant a dependency: three variants, a timer, and a
 * context so any component can raise one without threading a callback down.
 */

type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<(kind: ToastKind, message: string) => void>(() => {});

export const useToast = () => useContext(ToastContext);

const ICON = {
  success: CheckCircle2Icon,
  error: XCircleIcon,
  info: InfoIcon,
} as const;

const STYLE: Record<ToastKind, string> = {
  success: 'border-success/40 bg-card text-foreground',
  error: 'border-destructive/50 bg-card text-foreground',
  info: 'border-border bg-card text-foreground',
};

const ICON_STYLE: Record<ToastKind, string> = {
  success: 'text-success',
  error: 'text-destructive',
  info: 'text-muted-foreground',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: ToastKind, message: string) => {
    // Date.now() collides when two land in the same millisecond, which happens
    // when a batch finishes; the random suffix keeps React keys unique.
    const id = Date.now() + Math.random();
    setToasts((all) => [...all, { id, kind, message }]);
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), 6000);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const Icon = ICON[toast.kind];
          return (
            <div
              key={toast.id}
              className={cn(
                'pointer-events-auto flex items-start gap-2 rounded-lg border p-3 text-sm shadow-lg',
                STYLE[toast.kind],
              )}
            >
              <Icon className={cn('mt-0.5 size-4 shrink-0', ICON_STYLE[toast.kind])} />
              <span className="min-w-0 break-words">{toast.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
