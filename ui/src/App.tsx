import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClockIcon,
  Loader2Icon,
  PencilLineIcon,
  PlayIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
} from 'lucide-react';
import {
  MODULE,
  api,
  apiJson,
  fetchModules,
  isPodcast,
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
import { Textarea } from '@/components/ui/textarea';
import { ProjectCard } from '@/components/ProjectCard';
import {
  ProjectFilters,
  matchesFilter,
  matchesQuery,
  type FilterId,
} from '@/components/ProjectFilters';
import { ProjectDialog } from '@/screens/ProjectDialog';
import { useToast } from '@/components/Toaster';
import { cn } from '@/lib/utils';

export function App() {
  const toast = useToast();

  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [slot, setSlot] = useState<ScheduleSlot | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  /**
   * The long-form channel's prompt: a description of the video plus the pages
   * it should be built from, as one block of text. Only that module asks for
   * it - a thirty-second short is one fact and has nothing to say beyond its
   * title.
   */
  const [newPrompt, setNewPrompt] = useState('');

  /** Whether this module takes a free-form prompt when the topic is typed. */
  const usesPrompt = MODULE === 'factlong';

  /**
   * The links in the prompt, shown back live as the person types.
   *
   * The same rule the server applies, so what is listed here is what the
   * research call will be told to read. Showing it is the point: a link pasted
   * with a stray bracket, or one that is not a link at all, is visible before
   * an hour of pipeline is spent on it rather than after.
   */
  const promptSources = useMemo(() => {
    const found = newPrompt.match(/https?:\/\/[^\s<>"'`]+/giu) ?? [];
    const cleaned = found.map((u) => u.replace(/[)\]}.,;:!?'"]+$/u, ''));
    return [...new Set(cleaned)].slice(0, 12);
  }, [newPrompt]);

  /**
   * Who chooses what the video is about.
   *
   * Typing a name is not merely a label here - the name *is* the topic, and it
   * steers both the suggestion and the script. So "I have no idea, give me
   * one" was not expressible: you had to invent a subject before you could
   * make a project, which is the opposite of what a channel needing twelve
   * videos a day wants at nine in the evening.
   */
  const [topicMode, setTopicMode] = useState<'named' | 'auto'>('named');
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

  /**
   * Deletes what is ticked, after saying plainly what that costs.
   *
   * Two things the confirmation has to name, because neither is obvious and
   * both are irreversible:
   *
   * - **A published video stays published.** This removes local files; it has
   *   no access to YouTube and cannot unpublish anything. Somebody clearing out
   *   finished projects to tidy up would otherwise assume the opposite.
   * - **The subject stays spent.** `de-tai.json` outlives the project on
   *   purpose, so deleting does not free the idea for a future video.
   *
   * The count is in the message rather than only in the bar, because the bar is
   * at the bottom of the screen and the dialog is in the middle - and "Xoá 14
   * dự án?" is the number people actually check.
   */
  const deleteSelected = async () => {
    const ids = [...selected];
    const uploaded = (projects ?? []).filter((p) => ids.includes(p.id) && p.youtubeUrl).length;

    const warning = [
      `Xoá hẳn ${ids.length} dự án?`,
      '',
      'Mất toàn bộ kịch bản, giọng đọc và video đã dựng trên máy. Không hoàn lại được.',
      uploaded > 0
        ? `${uploaded} dự án đã đăng YouTube - video trên YouTube VẪN CÒN, phải tự xoá bên đó.`
        : '',
      'Đề tài vẫn nằm trong sổ de-tai.json, nên sẽ không bị làm lại.',
    ]
      .filter(Boolean)
      .join('\n');

    if (!confirm(warning)) return;

    try {
      const result = await apiJson<{
        deleted: number;
        skipped: { id: string; reason: string }[];
      }>('/projects/bulk-delete', 'POST', { projectIds: ids });

      // Named rather than counted: "bỏ qua 2" leaves a person hunting for
      // which two, and the usual reason is that they are still rendering.
      const skipped = result.skipped.length
        ? ` Bỏ qua ${result.skipped.map((s) => `${s.id} (${s.reason})`).join(', ')}.`
        : '';
      toast(result.deleted > 0 ? 'success' : 'info', `Đã xoá ${result.deleted} dự án.${skipped}`);

      setSelected(new Set());
      // Refetched rather than filtered locally: the server is the authority on
      // what is still there, and a project it refused to delete has to come
      // back into the list rather than vanish from it.
      await loadProjects();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const createProject = async () => {
    const name = newName.trim();
    const prompt = usesPrompt ? newPrompt.trim() : '';
    const auto = topicMode === 'auto';
    if (!auto && !name && !prompt) return;
    try {
      const created = await apiJson<ProjectSummary>(
        '/projects',
        'POST',
        auto ? { mode: 'auto' } : { name, ...(prompt ? { prompt } : {}) },
      );
      setCreating(false);
      setNewName('');
      setNewPrompt('');
      await loadProjects().then(loadRuns);
      // Opened either way now: in auto mode the pipeline is already running,
      // and the row of boxes inside the project is the thing worth watching.
      setOpenId(created.id);
      if (auto) toast('info', 'Đang chạy — bước đầu là Claude nghĩ đề tài');
      else if (prompt) {
        toast(
          'info',
          promptSources.length
            ? `Đang chạy — Claude đọc ${promptSources.length} nguồn trước rồi mới viết`
            : 'Đang chạy theo prompt của bạn',
        );
      }
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
          {/*
            Destructive, and placed away from "Chạy tất cả" with the muted
            controls between them: the two buttons act on the same selection and
            one of them cannot be undone.
          */}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Bỏ chọn
          </Button>
          <span className="flex-1" />
          <Button size="sm" variant="destructive" onClick={deleteSelected}>
            <Trash2Icon />
            Xoá đã chọn
          </Button>
        </div>
      )}

      {/* ---- New project ------------------------------------------------ */}
      <Dialog open={creating} onOpenChange={setCreating}>
        {/* Wider when there is a prompt to write: a seven-line box of prose
            and links squeezed into a title-sized dialog wraps every URL. */}
        <DialogContent className={usesPrompt ? 'max-w-xl' : 'max-w-md'}>
          <DialogHeader>
            <DialogTitle>Dự án mới</DialogTitle>
          </DialogHeader>
          {/*
            Two tiles rather than a dropdown or a checkbox: this is the first
            decision of the whole flow and it changes what the rest of the
            dialog asks for, which is more than a control tucked into a corner
            should be able to do.
          */}
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                {
                  id: 'named' as const,
                  icon: PencilLineIcon,
                  title: 'Tôi tự đặt đề tài',
                  body: usesPrompt
                    ? 'Viết mô tả, dán nguồn - kịch bản và hình bám theo đó.'
                    : 'Gõ đề tài, Claude viết kịch bản bám theo đúng nó.',
                },
                {
                  id: 'auto' as const,
                  icon: SparklesIcon,
                  title: 'Claude nghĩ đề tài',
                  body: 'Tạo xong là chạy luôn cả pipeline, bước đầu là nghĩ đề tài.',
                },
              ]
            ).map((choice) => {
              const active = topicMode === choice.id;
              const Icon = choice.icon;
              return (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => setTopicMode(choice.id)}
                  aria-pressed={active}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-lg border-2 p-3 text-left',
                    'transition-all duration-150 active:scale-[0.98]',
                    active
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-muted-foreground/40',
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Icon className={cn('size-4', active ? 'text-primary' : 'text-muted-foreground')} />
                    {choice.title}
                  </span>
                  <span className="text-muted-foreground text-xs leading-snug">{choice.body}</span>
                </button>
              );
            })}
          </div>

          {topicMode === 'named' && usesPrompt ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-prompt">Prompt</Label>
                <Textarea
                  id="new-prompt"
                  autoFocus
                  rows={7}
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  placeholder={
                    'VD: Video về con lười - vì sao chúng chậm đến mức rêu mọc trên lông, và ' +
                    'vì sao cách sống đó lại giúp chúng sống sót. Giọng hài hước.\n\n' +
                    'Nguồn:\nhttps://en.wikipedia.org/wiki/Sloth\n' +
                    'https://commons.wikimedia.org/wiki/Category:Bradypus'
                  }
                  className="min-h-36 text-sm"
                />
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Mô tả video bạn muốn, rồi dán các đường link. Claude <strong>đọc hết các link
                  trước</strong> rồi mới viết - câu chuyện lấy từ đó, không tự đổi sang chuyện khác.
                  Link dạng <code>commons.wikimedia.org/wiki/Category:…</code> sẽ được dùng thẳng
                  làm nguồn ảnh.
                </p>
              </div>

              {/*
                Echoed back as it is typed, so a link that did not parse - a
                trailing bracket, a missing https - is visible now rather than
                after an hour of pipeline has run without it.
              */}
              {promptSources.length > 0 && (
                <div className="bg-muted/50 flex flex-col gap-1 rounded-md p-2.5">
                  <span className="text-xs font-medium">
                    Claude sẽ đọc {promptSources.length} nguồn:
                  </span>
                  {promptSources.map((url) => (
                    <span key={url} className="text-muted-foreground truncate font-mono text-[11px]">
                      {url.includes('commons.wikimedia.org') && url.includes('Category:') ? '🖼 ' : '📄 '}
                      {url}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-name">
                  Tên dự án <span className="text-muted-foreground font-normal">(không bắt buộc)</span>
                </Label>
                <Input
                  id="new-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Để trống thì lấy dòng đầu của prompt"
                />
              </div>

              <p className="text-warning text-xs leading-relaxed">
                Bấm Tạo dự án là <strong>chạy luôn cả pipeline</strong>, và dựng xong sẽ{' '}
                <strong>lên lịch đăng YouTube</strong> theo mặc định. Không muốn thì mở dự án ra đổi
                ô “Sau khi dựng xong”.
              </p>
            </div>
          ) : topicMode === 'named' ? (
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
                Tên này chính là đề tài — kịch bản sẽ bám theo nó.
              </p>
            </div>
          ) : (
            <div className="text-muted-foreground flex flex-col gap-2 rounded-md border border-dashed p-3 text-xs leading-relaxed">
              <p>
                Bấm Tạo dự án là <strong>chạy luôn cả pipeline</strong>, và bước đầu tiên là
                Claude nghĩ đề tài: Ý tưởng → Kịch bản → Tìm ảnh →
                Giọng đọc → Dựng video → Kiểm tra → Đăng YouTube.
              </p>
              <p>
                Tên dự án đang là <strong>“Đang nghĩ đề tài…”</strong> và sẽ tự đổi thành đề tài
                nó chọn, khoảng một phút nữa.
              </p>
              {/*
                Said out loud because it is the one consequence that leaves this
                machine: a new project defaults to publishing, so this button
                ends on the live channel unless somebody changes that. The run
                reads the setting only when the render finishes, so there is
                still time to change it while the video is being made.
              */}
              <p className="text-warning">
                Dựng xong nó sẽ <strong>lên lịch đăng YouTube</strong> theo mặc định. Không muốn
                thì mở dự án ra đổi ô “Sau khi dựng xong” — vẫn kịp trong lúc video đang dựng.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Huỷ
            </Button>
            <Button
              onClick={createProject}
              disabled={topicMode === 'named' && !newName.trim() && !(usesPrompt && newPrompt.trim())}
            >
              {topicMode === 'auto' ? <SparklesIcon /> : null}
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
    </div>
  );
}
