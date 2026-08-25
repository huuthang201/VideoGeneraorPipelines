import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClockIcon, ImagesIcon, Loader2Icon, PlayIcon, PlusIcon } from 'lucide-react';
import {
  MODULE,
  api,
  apiJson,
  fetchModules,
  isPodcast,
  type LibraryIndex,
  type ModuleInfo,
  type ProjectSummary,
  type RunState,
  type ScheduleSlot,
} from '@/lib/api';
import { useEvents } from '@/lib/useEvents';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ProjectCard } from '@/components/ProjectCard';
import {
  ProjectFilters,
  matchesFilter,
  matchesQuery,
  type FilterId,
} from '@/components/ProjectFilters';
import { ProjectDialog } from '@/screens/ProjectDialog';
import { LibraryDialog } from '@/screens/LibraryDialog';
import { useToast } from '@/components/Toaster';

export function App() {
  const toast = useToast();

  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [library, setLibrary] = useState<LibraryIndex | null>(null);
  const [slot, setSlot] = useState<ScheduleSlot | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [filter, setFilter] = useState<FilterId>('all');
  const [query, setQuery] = useState('');

  const me = modules.find((m) => m.id === MODULE);

  const loadProjects = useCallback(async () => {
    const list = await api<ProjectSummary[]>('/projects');
    setProjects(list);
    return list;
  }, []);

  /**
   * The pipeline boxes for every card on screen.
   *
   * Fetched once up front rather than per card mounting its own request: twenty
   * cards each firing on mount is twenty round trips for a grid that then sits
   * still, and after this the SSE stream keeps them current for free.
   */
  const loadRuns = useCallback(async (list: ProjectSummary[]) => {
    const entries = await Promise.all(
      list.map(async (p) => {
        try {
          return [p.id, await api<RunState>(`/projects/${p.id}/pipeline/run`)] as const;
        } catch {
          return null;
        }
      }),
    );
    setRuns(Object.fromEntries(entries.filter((e): e is [string, RunState] => e !== null)));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [mods, list] = await Promise.all([
          fetchModules().catch(() => [] as ModuleInfo[]),
          loadProjects(),
        ]);
        setModules(mods);
        await loadRuns(list);
      } catch (err) {
        toast('error', err instanceof Error ? err.message : String(err));
        setProjects([]);
      }
    })();
  }, [loadProjects, loadRuns, toast]);

  useEffect(() => {
    if (!me) return;
    document.title = me.label;
  }, [me]);

  const refreshSlot = useCallback(async () => {
    try {
      setSlot(await api<ScheduleSlot>('/schedule'));
    } catch {
      setSlot(null);
    }
  }, []);

  useEffect(() => {
    void refreshSlot();
    // A slot is consumed by an upload, which may be started from another tab -
    // and the minute hand moves regardless.
    const timer = setInterval(() => void refreshSlot(), 60_000);
    return () => clearInterval(timer);
  }, [refreshSlot]);

  useEffect(() => {
    if (!isPodcast()) return;
    void api<LibraryIndex>('/library')
      .then(setLibrary)
      .catch(() => setLibrary(null));
  }, []);

  useEvents({
    onRun: ({ projectId, run, summary }) => {
      setRuns((all) => ({ ...all, [projectId]: run }));
      if (summary) {
        setProjects((all) => all?.map((p) => (p.id === projectId ? summary : p)) ?? all);
      }
    },
    onUpdate: ({ projectId, summary }) => {
      setProjects((all) => all?.map((p) => (p.id === projectId ? summary : p)) ?? all);
    },
    onDone: ({ projectId, ok, message, summary }) => {
      toast(ok ? 'success' : 'error', `${projectId}: ${message}`);
      if (summary) {
        setProjects((all) => all?.map((p) => (p.id === projectId ? summary : p)) ?? all);
      }
      void api<RunState>(`/projects/${projectId}/pipeline/run`)
        .then((run) => setRuns((all) => ({ ...all, [projectId]: run })))
        .catch(() => undefined);
      void refreshSlot();
    },
  });

  const start = async (id: string) => {
    try {
      await apiJson(`/projects/${id}/pipeline/start`, 'POST', {});
      toast('info', `${id}: đã bắt đầu`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const startSelected = async () => {
    try {
      const result = await apiJson<{ count: number; skipped: number }>('/batch', 'POST', {
        projectIds: [...selected],
        mode: 'sequential',
      });
      toast('info', `Đã xếp hàng ${result.count} dự án${result.skipped ? `, bỏ qua ${result.skipped} đang chạy` : ''}`);
      setSelected(new Set());
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const createProject = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await apiJson<ProjectSummary>('/projects', 'POST', { name });
      setCreating(false);
      setNewName('');
      await loadProjects().then(loadRuns);
      setOpenId(created.id);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const runningCount = useMemo(
    () => Object.values(runs).filter((r) => r.status === 'running').length,
    [runs],
  );

  /*
   * Search first, then the bucket - and the sidebar counts what the search
   * left, not the whole library. That way the numbers describe what is on
   * screen: type "mat ong" and the sidebar answers "3 kết quả, 2 đã đăng",
   * which is the question someone typing a name is actually asking.
   */
  const searched = useMemo(
    () => (projects ?? []).filter((p) => matchesQuery(query, p)),
    [projects, query],
  );
  const visible = useMemo(
    () => searched.filter((p) => matchesFilter(filter, p, runs[p.id])),
    [searched, filter, runs],
  );

  return (
    <div className="min-h-dvh">
      <header className="bg-card/80 sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b px-4 py-3 backdrop-blur">
        <h1 className="text-base font-semibold">{me?.label ?? 'Video Generator'}</h1>

        {/* Switching module reloads: the two are different collections of
            projects on different channels, so nothing on screen survives it. */}
        <Select
          value={MODULE}
          onValueChange={(value) => {
            location.search = `?m=${encodeURIComponent(value)}`;
          }}
        >
          <SelectTrigger size="sm" className="w-40" aria-label="Chọn pipeline">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {modules.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {runningCount > 0 && (
          <Badge variant="default" className="gap-1">
            <Loader2Icon className="size-3 animate-spin" />
            {runningCount} đang chạy
          </Badge>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {slot?.ready && (
            <span
              className="text-muted-foreground hidden items-center gap-1 text-xs sm:inline-flex"
              title={`Mỗi ${slot.intervalHours} giờ một video. Chỉ bị chiếm khi tải lên thật.`}
            >
              <ClockIcon className="size-3" />
              Lịch kế:{' '}
              {new Date(slot.publishAt).toLocaleString('vi-VN', {
                hour: '2-digit',
                minute: '2-digit',
                day: '2-digit',
                month: '2-digit',
              })}
            </span>
          )}

          {isPodcast() && (
            <Button variant="secondary" size="sm" onClick={() => setLibraryOpen(true)}>
              <ImagesIcon />
              Thư viện chung
              {library && <Badge variant="outline">{library.counts.environment}</Badge>}
            </Button>
          )}

          <Button size="sm" onClick={() => setCreating(true)}>
            <PlusIcon />
            Thêm dự án
          </Button>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-4 p-4 lg:flex-row">
        {projects !== null && projects.length > 0 && (
          <ProjectFilters
            projects={searched}
            runs={runs}
            filter={filter}
            onFilter={setFilter}
            query={query}
            onQuery={setQuery}
          />
        )}

        <div className="min-w-0 flex-1">
          {projects === null ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className={isPodcast() ? 'aspect-video' : 'aspect-[9/16]'} />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-3 py-24 text-center">
              <p className="text-sm">Chưa có dự án nào.</p>
              <Button onClick={() => setCreating(true)}>
                <PlusIcon />
                Tạo dự án đầu tiên
              </Button>
            </div>
          ) : visible.length === 0 ? (
            /* The library is not empty - this view of it is. Saying so, and
               offering the way back, beats an empty grid that reads as a
               loading failure. */
            <div className="text-muted-foreground flex flex-col items-center gap-3 py-24 text-center">
              <p className="text-sm">
                Không có dự án nào khớp{query.trim() ? ` với “${query.trim()}”` : ''}.
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  setFilter('all');
                  setQuery('');
                }}
              >
                Bỏ lọc
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">
              {visible.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  run={runs[project.id]}
                  selected={selected.has(project.id)}
                  onToggleSelect={() =>
                    setSelected((all) => {
                      const next = new Set(all);
                      if (next.has(project.id)) next.delete(project.id);
                      else next.add(project.id);
                      return next;
                    })
                  }
                  onOpen={() => setOpenId(project.id)}
                  onStart={() => start(project.id)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* ---- Batch bar ------------------------------------------------- */}
      {selected.size > 0 && (
        <div className="bg-card fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center gap-3 border-t px-4 py-3 shadow-lg">
          <span className="text-sm font-medium">Đã chọn {selected.size} dự án</span>
          <Button size="sm" onClick={startSelected}>
            <PlayIcon />
            Chạy tất cả
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Bỏ chọn
          </Button>
        </div>
      )}

      {/* ---- New project ------------------------------------------------ */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Dự án mới</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-name">Tên dự án</Label>
            <Input
              id="new-name"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void createProject()}
              placeholder={
                isPodcast() ? 'VD: Rainy morning in Hanoi' : 'VD: Mật ong không bao giờ hỏng'
              }
            />
            <p className="text-muted-foreground text-xs">
              {isPodcast()
                ? 'Không cần tải ảnh riêng: cảnh được dựng từ thư viện chung.'
                : 'Không cần chuẩn bị gì thêm — bấm Bắt đầu là chạy hết.'}
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Huỷ
            </Button>
            <Button onClick={createProject} disabled={!newName.trim()}>
              Tạo dự án
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {openId && (
        <ProjectDialog
          projectId={openId}
          run={runs[openId]}
          onClose={() => setOpenId(null)}
          onChanged={() => void loadProjects()}
        />
      )}

      {libraryOpen && (
        <LibraryDialog
          onClose={() => setLibraryOpen(false)}
          onChanged={(next) => {
            setLibrary(next);
            void loadProjects();
          }}
        />
      )}
    </div>
  );
}
