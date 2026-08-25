import { CheckIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mediaPath, type LibraryIndex } from '@/lib/api';
import { Button } from '@/components/ui/button';

/**
 * Which backdrops this episode may draw on. Podcast only.
 *
 * Empty means the whole library, which is both how it is stored and the right
 * default - a project must not freeze its shortlist the day someone uploads a
 * better photograph. That is why clicking one tile when everything is in play
 * means "only this one" rather than "all but this one": a naive toggle would
 * turn a click on a picture into a 17-of-18 selection, which is never what
 * anyone meant.
 */

/** Below this a long episode starts showing the same photograph on repeat. */
const COMFORTABLE_ENVIRONMENTS = 8;

export function ScenePicker({
  library,
  picked,
  disabled,
  onChange,
}: {
  library: LibraryIndex;
  picked: string[];
  disabled: boolean;
  /** May return the save, so the two buttons below can show it landing. */
  onChange: (picked: string[]) => void | Promise<void>;
}) {
  const files = library.environment;
  const usingAll = picked.length === 0;
  const inPlay = usingAll ? files.length : picked.length;

  const toggle = (filename: string) => {
    if (disabled) return;
    let next: string[];
    if (usingAll) next = [filename];
    else if (picked.includes(filename)) next = picked.filter((n) => n !== filename);
    else next = [...picked, filename];

    // Picking every image says the same thing as picking none, and storing it
    // as none keeps the project working when the library grows later.
    onChange(next.length === files.length ? [] : next);
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">Ảnh dùng cho tập này</h3>
        <span className="text-muted-foreground text-xs">
          {files.length === 0 ? '' : usingAll ? `dùng cả ${files.length} ảnh` : `${inPlay}/${files.length} ảnh`}
        </span>
      </div>

      <p className="text-muted-foreground text-xs">
        {!library.ready
          ? 'Thư viện chung chưa có ảnh cảnh nào — mở thư viện để thêm.'
          : inPlay < COMFORTABLE_ENVIRONMENTS
            ? `Tập 5-10 phút nên có từ ${COMFORTABLE_ENVIRONMENTS} ảnh trở lên, nếu không cùng một ảnh sẽ lặp lại nhiều lần.`
            : 'Claude chỉ được chọn trong những ảnh đang sáng, và tự quyết ảnh nào hợp đoạn nào.'}
      </p>

      {files.length > 0 && (
        <div className="grid max-h-52 grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2 overflow-y-auto rounded-md border p-2">
          {files.map((filename) => {
            const selected = usingAll || picked.includes(filename);
            return (
              <button
                key={filename}
                type="button"
                disabled={disabled}
                onClick={() => toggle(filename)}
                title={filename}
                className={cn(
                  'relative aspect-video overflow-hidden rounded border-2 transition-all duration-150',
                  !disabled && 'active:scale-95',
                  selected ? 'border-primary' : 'border-transparent opacity-40',
                  disabled && 'cursor-not-allowed',
                )}
              >
                <img
                  src={mediaPath(`/library/environment/${filename}`)}
                  alt={filename}
                  loading="lazy"
                  className="size-full object-cover"
                />
                {selected && (
                  <span className="bg-primary text-primary-foreground absolute top-1 right-1 flex size-4 items-center justify-center rounded-full">
                    <CheckIcon className="size-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || usingAll || files.length === 0}
          onClick={() => onChange([])}
        >
          Chọn tất cả
        </Button>
        {/* "Deselect everything" would leave nothing to draw, so it keeps one:
            the honest reading of the button is "start choosing". */}
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || files.length === 0}
          onClick={() => onChange(files.slice(0, 1))}
        >
          Bỏ chọn hết
        </Button>
      </div>
    </section>
  );
}
