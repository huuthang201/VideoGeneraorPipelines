import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClapperboardIcon,
  LayersIcon,
  Loader2Icon,
  PencilLineIcon,
  SearchIcon,
  MonitorPlayIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProjectSummary, RunState } from '@/lib/api';
import { Input } from '@/components/ui/input';

/**
 * The sidebar: how many projects are in each state, and a way to see only those.
 *
 * Counted here, on the client, from the list the page is already holding -
 * not fetched from the server. Every field the counts need is on
 * `ProjectSummary`, so a server-side tally would be a second source of truth
 * that can disagree with the grid beside it; the moment SSE updates one
 * project, both the card and its count move together because they read the
 * same object.
 *
 * ## Why "Đã dựng xong" has children rather than siblings
 *
 * A finished video is either on the channel or it is not, so "đã đăng" and
 * "chưa đăng" add up to it exactly. Listing all three flat would show a total
 * that is double-counted and invite the reading that they are three separate
 * piles. Indented, the arithmetic is visible: the parent is the sum.
 *
 * The buckets are deliberately drawn from durable project state - is there a
 * video, is there a YouTube url - rather than from the live run. A project
 * whose upload failed is *not* filed under "Lỗi": the video exists and is not
 * on the channel, which is precisely "Chưa đăng", and that stays true after
 * the server restarts and forgets the run.
 */

export type FilterId =
  | 'all'
  | 'running'
  | 'failed'
  | 'rendered'
  | 'published'
  | 'unpublished'
  | 'draft';

interface Bucket {
  id: FilterId;
  label: string;
  icon: LucideIcon;
  /** Colour for the icon; the count and label stay neutral. */
  tone?: string;
  /** Set on the two that make up "Đã dựng xong". */
  child?: boolean;
  /** A rule above this row, on wide screens where the list is a column. */
  divide?: boolean;
}

const BUCKETS: Bucket[] = [
  { id: 'all', label: 'Tất cả', icon: LayersIcon },
  { id: 'running', label: 'Đang chạy', icon: Loader2Icon, tone: 'text-primary', divide: true },
  { id: 'failed', label: 'Lỗi', icon: AlertTriangleIcon, tone: 'text-destructive' },
  {
    id: 'rendered',
    label: 'Đã dựng xong',
    icon: ClapperboardIcon,
    tone: 'text-success',
    divide: true,
  },
  { id: 'published', label: 'Đã đăng', icon: MonitorPlayIcon, tone: 'text-red-600', child: true },
  { id: 'unpublished', label: 'Chưa đăng', icon: CheckCircle2Icon, child: true },
  { id: 'draft', label: 'Chưa dựng', icon: PencilLineIcon, divide: true },
];

/**
 * Name search that ignores tones.
 *
 * Every project here is named in Vietnamese, and someone hunting for "Mật ong
 * không bao giờ hỏng" types "mat ong" - nobody fights an input method for six
 * diacritics to filter a list. NFD splits the marks off so they can be dropped;
 * `đ` has no decomposition and is folded by hand.
 */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

export function matchesQuery(query: string, project: ProjectSummary): boolean {
  const needle = fold(query.trim());
  if (!needle) return true;
  return fold(project.displayName).includes(needle) || project.id.includes(needle);
}

/** Whether one project belongs in one bucket. The only definition of that. */
export function matchesFilter(
  filter: FilterId,
  project: ProjectSummary,
  run: RunState | undefined,
): boolean {
  const running = run?.status === 'running' || project.badge === 'RUNNING';
  switch (filter) {
    case 'all':
      return true;
    case 'running':
      return running;
    case 'failed':
      return !running && project.badge === 'FAILED';
    case 'rendered':
      return project.hasVideo;
    case 'published':
      return project.youtubeUrl !== null;
    case 'unpublished':
      return project.hasVideo && project.youtubeUrl === null;
    case 'draft':
      return !project.hasVideo && !running && project.badge !== 'FAILED';
  }
}

export function ProjectFilters({
  projects,
  runs,
  filter,
  onFilter,
  query,
  onQuery,
}: {
  projects: ProjectSummary[];
  runs: Record<string, RunState>;
  filter: FilterId;
  onFilter: (id: FilterId) => void;
  query: string;
  onQuery: (value: string) => void;
}) {
  const count = (id: FilterId) =>
    projects.reduce((n, p) => (matchesFilter(id, p, runs[p.id]) ? n + 1 : n), 0);

  return (
    <aside className="lg:sticky lg:top-[4.25rem] lg:w-56 lg:shrink-0 lg:self-start">
      <div className="relative mb-2">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Tìm theo tên…"
          aria-label="Tìm dự án theo tên"
          className="h-8 pl-8 text-sm"
        />
      </div>

      {/*
        A column beside the grid when there is room, a wrapping row of chips
        above it when there is not. One list either way - a second, narrower
        copy of the same buttons is how the two quietly stop agreeing.
      */}
      <nav
        className="flex flex-wrap gap-1 lg:flex-col lg:flex-nowrap"
        aria-label="Lọc dự án theo trạng thái"
      >
        {BUCKETS.map((bucket) => {
          const n = count(bucket.id);
          const active = filter === bucket.id;
          const Icon = bucket.icon;
          return (
            <div key={bucket.id} className="contents">
              {bucket.divide && <span className="bg-border my-1 hidden h-px w-full lg:block" />}
              <button
                type="button"
                onClick={() => onFilter(bucket.id)}
                aria-pressed={active}
                // An empty bucket is still worth showing - "0 lỗi" is
                // information - but it is not worth clicking into.
                disabled={n === 0 && bucket.id !== 'all' && !active}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm',
                  'transition-all duration-150 active:scale-[0.97]',
                  'disabled:pointer-events-none disabled:opacity-40',
                  'lg:w-full lg:justify-start',
                  bucket.child && 'lg:pl-7',
                  active
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'hover:bg-muted text-foreground',
                )}
              >
                <Icon
                  className={cn(
                    'size-3.5 shrink-0',
                    active ? 'text-primary' : (bucket.tone ?? 'text-muted-foreground'),
                    bucket.id === 'running' && n > 0 && 'animate-spin',
                  )}
                />
                <span className="truncate">{bucket.label}</span>
                <span
                  className={cn(
                    'ml-auto pl-1 text-xs tabular-nums',
                    active ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  {n}
                </span>
              </button>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
