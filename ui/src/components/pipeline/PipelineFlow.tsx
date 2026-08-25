import { Fragment } from 'react';
import {
  CheckIcon,
  ImageIcon,
  Loader2Icon,
  LightbulbIcon,
  FileTextIcon,
  MicIcon,
  FilmIcon,
  ShieldCheckIcon,
  UploadIcon,
  XIcon,
  MinusIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isPodcast, type RunState, type RunStep, type StepId, type StepStatus } from '@/lib/api';
import { formatDuration } from './StepPanel';

/**
 * The pipeline as a rail of nodes.
 *
 * The whole point of this strip is that a run takes minutes and used to give no
 * sign of where it was - a spinner and a stage name in a corner. Someone
 * glancing at it should be able to say "it's on the voice, two steps to go"
 * without reading anything.
 *
 * It was a row of cards, each carrying a line of detail about what it had
 * produced. Two things were wrong with that. The cards were wide enough that
 * seven of them needed a horizontal scrollbar, so the last steps of the run -
 * the ones you are waiting for - were the ones off screen. And the detail line
 * reserved three lines of height whether or not there was any detail, which
 * left every finished run looking like a row of half-empty boxes.
 *
 * Now the detail lives in the step's own dialog, one click away, and the strip
 * only has to answer *where are we*. A node and a label answers that in a
 * quarter of the width, so the whole run fits without scrolling.
 *
 * Labels live here rather than on the server because they are per module and
 * they are interface copy: the podcast picks a photograph out of a library the
 * user uploaded, the fact short goes and searches for one. Same step id, two
 * honest descriptions.
 */

interface StepMeta {
  label: string;
  icon: LucideIcon;
  /** What this step is doing, shown under the label while it runs. */
  hint: string;
}

const COMMON: Record<Exclude<StepId, 'images' | 'brief'>, StepMeta> = {
  storyboard: { label: 'Kịch bản', icon: FileTextIcon, hint: 'Claude đang viết…' },
  voice: { label: 'Giọng đọc', icon: MicIcon, hint: 'Đang tổng hợp giọng…' },
  render: { label: 'Dựng video', icon: FilmIcon, hint: 'Đang render…' },
  check: { label: 'Kiểm tra', icon: ShieldCheckIcon, hint: 'Đang kiểm tra…' },
  upload: { label: 'Đăng YouTube', icon: UploadIcon, hint: 'Đang tải lên…' },
};

function stepMeta(id: StepId): StepMeta {
  if (id === 'brief') {
    return {
      label: 'Ý tưởng',
      icon: LightbulbIcon,
      hint: isPodcast() ? 'Đang xem thư viện ảnh…' : 'Đang nghĩ đề tài…',
    };
  }
  if (id === 'images') {
    return {
      label: isPodcast() ? 'Chọn ảnh' : 'Tìm ảnh',
      icon: ImageIcon,
      hint: isPodcast() ? 'Đang lấy ảnh…' : 'Đang tìm ảnh…',
    };
  }
  return COMMON[id];
}

/**
 * How a node reads at a glance.
 *
 * Colour carries the state and nothing else does, so the five have to stay
 * distinguishable without it: done is filled, running is ringed, pending is a
 * hollow outline, failed is filled in the alarm colour, skipped is dashed.
 */
const NODE_STYLE: Record<StepStatus, string> = {
  pending: 'border-border bg-card text-muted-foreground',
  running: 'border-primary bg-primary/10 text-primary ring-4 ring-primary/15',
  done: 'border-success/50 bg-success/15 text-success',
  failed: 'border-destructive bg-destructive/15 text-destructive ring-4 ring-destructive/15',
  skipped: 'border-dashed border-border bg-muted/50 text-muted-foreground/70',
};

const LABEL_STYLE: Record<StepStatus, string> = {
  pending: 'text-muted-foreground',
  running: 'text-foreground font-medium',
  done: 'text-foreground',
  failed: 'text-destructive font-medium',
  skipped: 'text-muted-foreground/70',
};

const STATUS_WORD: Record<StepStatus, string> = {
  pending: 'Chờ',
  running: 'Đang chạy',
  done: 'Xong',
  failed: 'Lỗi',
  skipped: 'Bỏ qua',
};

function NodeMark({ status, Icon }: { status: StepStatus; Icon: LucideIcon }) {
  if (status === 'running') return <Loader2Icon className="size-4 animate-spin" />;
  if (status === 'done') return <CheckIcon className="size-4" />;
  if (status === 'failed') return <XIcon className="size-4" />;
  if (status === 'skipped') return <MinusIcon className="size-4" />;
  return <Icon className="size-4" />;
}

function Step({
  step,
  progress,
  queuePosition,
  selected,
  onSelect,
}: {
  step: RunStep;
  progress: RunState['progress'];
  queuePosition: number | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = stepMeta(step.id);
  const running = step.status === 'running';
  const elapsed = formatDuration(step.durationMs);

  /*
   * One line under the label, and only when it is worth the space: what the
   * step is doing while it runs, or how long it took once it is done. The
   * detail it produced is in the dialog - putting it here is what made the
   * previous version so tall.
   */
  const sub = running
    ? step.id === 'upload' && queuePosition !== null
      ? `xếp hàng: còn ${queuePosition}`
      : step.id === 'render' && progress && progress.total > 0
        ? `${Math.round((progress.rendered / progress.total) * 100)}%`
        : meta.hint
    : elapsed;

  return (
    <li className="min-w-0 flex-1">
      <button
        type="button"
        onClick={onSelect}
        title={`${meta.label} — ${STATUS_WORD[step.status]}${elapsed ? ` · ${elapsed}` : ''}${
          step.detail ? `\n${step.detail}` : ''
        }`}
        aria-current={running ? 'step' : undefined}
        className={cn(
          'group flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-md px-1 py-2',
          'focus-visible:ring-ring/50 transition-all duration-150 focus-visible:ring-[3px] focus-visible:outline-none',
          // A node opens a dialog, and until it paints nothing on the rail
          // moves. The press is the only thing that can answer immediately.
          'active:scale-95',
          selected ? 'bg-muted' : 'hover:bg-muted/60',
        )}
      >
        <span
          className={cn(
            'flex size-9 items-center justify-center rounded-full border-2 transition-colors',
            NODE_STYLE[step.status],
          )}
        >
          <NodeMark status={step.status} Icon={meta.icon} />
        </span>

        <span className={cn('max-w-full truncate text-xs', LABEL_STYLE[step.status])}>
          {meta.label}
        </span>

        {/* Held at a fixed height so the labels stay on one baseline whether or
            not a step has anything to say underneath. */}
        <span className="text-muted-foreground h-3.5 max-w-full truncate text-[11px] tabular-nums">
          {sub ?? ''}
        </span>
      </button>
    </li>
  );
}

/**
 * The rail between two nodes.
 *
 * It is a rail rather than an arrow because seven arrowheads across a strip
 * this narrow read as clutter, and the direction is already obvious from the
 * order. It only animates where work is actually crossing - the step behind
 * done, the step ahead running - since a permanently travelling line would say
 * "everything is happening", which is the opposite of what this is for.
 */
function Rail({ done, flowing }: { done: boolean; flowing: boolean }) {
  return (
    <li aria-hidden className="mt-[1.375rem] h-0.5 w-4 shrink-0 sm:w-6">
      <span
        className={cn(
          'block h-full w-full rounded-full',
          // `text-primary` rather than `bg-primary`: the moving stripes are
          // drawn from `currentColor`, so the colour has to reach them as text.
          flowing
            ? 'animate-flow-dash text-primary'
            : done
              ? 'bg-success/50'
              : 'bg-border',
        )}
      />
    </li>
  );
}

export function PipelineFlow({
  run,
  selected,
  onSelect,
}: {
  run: RunState;
  selected: StepId | null;
  onSelect: (id: StepId) => void;
}) {
  return (
    <ol className="flex items-start" aria-label="Tiến trình pipeline">
      {run.steps.map((step, index) => {
        const next = run.steps[index + 1];
        return (
          <Fragment key={step.id}>
            <Step
              step={step}
              progress={run.progress}
              queuePosition={run.queuePosition}
              selected={selected === step.id}
              onSelect={() => onSelect(step.id)}
            />
            {next && (
              <Rail
                done={step.status === 'done' || step.status === 'skipped'}
                flowing={step.status === 'done' && next.status === 'running'}
              />
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}
