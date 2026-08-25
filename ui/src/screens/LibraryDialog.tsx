import { useCallback, useEffect, useRef, useState } from 'react';
import { TrashIcon, UploadIcon } from 'lucide-react';
import { api, apiPath, mediaPath, type LibraryIndex } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/Toaster';

/**
 * The shared backdrop library. Podcast only.
 *
 * Not nested under a project on purpose: these photographs belong to the
 * module and every episode draws from them, so adding one here makes it
 * available to every project at once.
 */
export function LibraryDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: (library: LibraryIndex) => void;
}) {
  const toast = useToast();
  const [library, setLibrary] = useState<LibraryIndex | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const next = await api<LibraryIndex>('/library');
      setLibrary(next);
      onChanged(next);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  }, [onChanged, toast]);

  useEffect(() => {
    void load();
    // Only on open: `load` changes identity with its callbacks, and refetching
    // the library on every parent render would fight the upload in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upload = async () => {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) return;

    const form = new FormData();
    for (const file of files) form.append('images', file);

    setBusy(true);
    try {
      // FormData, so no Content-Type header: the browser has to set the
      // multipart boundary itself and naming the type strips it.
      const res = await fetch(apiPath('/library/environments'), { method: 'POST', body: form });
      const body = (await res.json()) as LibraryIndex & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Lỗi ${res.status}`);
      setLibrary(body);
      onChanged(body);
      if (fileRef.current) fileRef.current.value = '';
      toast('success', `Thư viện có ${body.counts.environment} ảnh cảnh`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (filename: string) => {
    setBusy(true);
    try {
      const res = await fetch(apiPath(`/library/environments/${encodeURIComponent(filename)}`), {
        method: 'DELETE',
      });
      const body = (await res.json()) as LibraryIndex & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Lỗi ${res.status}`);
      setLibrary(body);
      onChanged(body);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Thư viện chung</DialogTitle>
        </DialogHeader>

        <p className="text-muted-foreground text-sm">
          Ảnh ở đây dùng chung cho <strong>mọi dự án</strong>. Tải lên một lần, mọi tập podcast sau
          đó đều có thể lấy ra dựng cảnh. Ảnh ngang 16:9 hợp khung nhất; ảnh khác tỉ lệ vẫn dùng
          được, phần thừa sẽ được làm mờ hai bên.
        </p>

        <div className="grid max-h-[50vh] grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2 overflow-y-auto rounded-md border p-2">
          {library?.environment.map((filename) => (
            <figure key={filename} className="group relative aspect-video overflow-hidden rounded border">
              <img
                src={mediaPath(`/library/environment/${filename}`)}
                alt={filename}
                loading="lazy"
                className="size-full object-cover"
              />
              {/* A real Button, so the tile being deleted is the one that
                  spins - a plain element gave no sign which of twenty had
                  been clicked until the grid redrew. */}
              <Button
                variant="destructive"
                size="icon"
                disabled={busy}
                onClick={() =>
                  confirm(`Xoá ${filename} khỏi thư viện chung?`) ? remove(filename) : undefined
                }
                title={`Xoá ${filename}`}
                className="absolute top-1 right-1 size-6 rounded opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              >
                <TrashIcon className="size-3" />
              </Button>
            </figure>
          ))}
          {library?.environment.length === 0 && (
            <p className="text-muted-foreground col-span-full p-6 text-center text-sm">
              Chưa có ảnh nào.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/*" multiple className="text-sm" />
          <Button onClick={upload} disabled={busy} variant="secondary">
            <UploadIcon />
            Tải ảnh lên
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
