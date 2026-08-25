import { ImageIcon, Loader2Icon, PlayIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isPodcast, type ProjectBadge, type ProjectSummary, type RunState } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

const BADGE: Record<ProjectBadge, { label: string; variant: 'default' | 'secondary' | 'success' | 'destructive' | 'outline' }> =
  {
    NEW: { label: 'Chưa có kịch bản', variant: 'outline' },
    HAS_STORYBOARD: { label: 'Đã có kịch bản', variant: 'secondary' },
    RUNNING: { label: 'Đang chạy', variant: 'default' },
    DONE: { label: 'Xong', variant: 'success' },
    FAILED: { label: 'Lỗi', variant: 'destructive' },
  };

/** "8:12" from 492 seconds. */
function clock(seconds: number | null): string | null {
  if (seconds === null) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ProjectCard({
  project,
  run,
  selected,
  onToggleSelect,
  onOpen,
  onStart,
}: {
  project: ProjectSummary;
  run: RunState | undefined;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  /** Returns the request, so the button can spin until it lands. */
  onStart: () => void | Promise<void>;
}) {
  const badge = BADGE[project.badge];
  const running = run?.status === 'running';
  const activeStep = run?.steps.find((s) => s.status === 'running');

  return (
    <div
      className={cn(
        'group bg-card relative flex flex-col overflow-hidden rounded-xl border shadow-sm transition-shadow hover:shadow-md',
        selected && 'ring-primary ring-2',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'relative block w-full overflow-hidden bg-muted text-left',
          'transition-transform duration-150 active:scale-[0.98]',
          isPodcast() ? 'aspect-video' : 'aspect-[9/16]',
        )}
        aria-label={`Mở ${project.displayName}`}
      >
        {project.thumbnailUrl ? (
          <img
            src={project.thumbnailUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <span className="text-muted-foreground/40 flex size-full items-center justify-center">
            <ImageIcon className="size-8" />
          </span>
        )}

        {/* Selection and the YouTube marker sit over the picture, where they do
            not cost a row of layout on a grid that is mostly pictures. */}
        <span
          role="checkbox"
          aria-checked={selected}
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              onToggleSelect();
            }
          }}
          className={cn(
            'absolute top-2 left-2 flex size-5 cursor-pointer items-center justify-center rounded border-2 bg-black/40 backdrop-blur-sm',
            'transition-transform duration-150 active:scale-90',
            selected ? 'border-primary bg-primary' : 'border-white/70',
          )}
        >
          {selected && <span className="text-primary-foreground text-xs leading-none">✓</span>}
        </span>

        {project.youtubeUrl && (
          <span className="absolute top-2 right-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            YouTube
          </span>
        )}

        {running && (
          <span className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1.5 backdrop-blur-sm">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-white">
              <Loader2Icon className="size-3 animate-spin" />
              {activeStep ? stepWord(activeStep.id) : 'Đang chạy'}
            </span>
            {run?.progress && run.progress.total > 0 && (
              <Progress
                value={(run.progress.rendered / run.progress.total) * 100}
                className="mt-1 h-1 bg-white/25"
              />
            )}
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <button
          type="button"
          onClick={onOpen}
          className="line-clamp-2 text-left text-sm font-medium transition-opacity hover:underline active:opacity-60"
        >
          {project.displayName}
        </button>

        <div className="mt-auto flex items-center gap-2">
          <Badge variant={badge.variant}>{badge.label}</Badge>
          {project.durationSeconds !== null && (
            <span className="text-muted-foreground text-xs tabular-nums">
              {clock(project.durationSeconds)}
            </span>
          )}
          <Button
            size="sm"
            variant={project.badge === 'DONE' ? 'outline' : 'default'}
            className="ml-auto"
            disabled={running}
            onClick={onStart}
          >
            {running ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <>
                <PlayIcon />
                {project.badge === 'DONE' ? 'Chạy lại' : 'Bắt đầu'}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function stepWord(id: string): string {
  const words: Record<string, string> = {
    brief: 'Đang nghĩ đề tài',
    storyboard: 'Đang viết kịch bản',
    images: isPodcast() ? 'Đang lấy ảnh' : 'Đang tìm ảnh',
    voice: 'Đang đọc',
    render: 'Đang dựng',
    check: 'Đang kiểm tra',
    upload: 'Đang tải lên',
  };
  return words[id] ?? 'Đang chạy';
}
