import { FileTextIcon, ImageIcon } from 'lucide-react';
import type { DetectedSource } from '@/lib/sources';

/**
 * The links somebody pasted, each labelled with what it can actually supply.
 *
 * This exists because the difference is invisible until a video comes out
 * wrong. A person pastes six news articles expecting their photographs in the
 * video, and the photographs never arrive - not because anything broke, but
 * because a news page's pictures belong to the paper and cannot be republished
 * on a monetised channel without its say-so. Saying so next to the link, while
 * it is being typed, is the whole fix for that surprise: the article is still
 * read, still cited, still the backbone of the script.
 *
 * Unless the paper has said yes. That is a fact about this project that only
 * the channel owner knows, so it is a checkbox they tick, and once it is ticked
 * the same links are labelled as picture sources.
 */
export function SourceList({
  sources,
  permitted = false,
}: {
  sources: readonly DetectedSource[];
  /**
   * The channel owner has the papers' permission, so a news link supplies its
   * photographs too. Set per project, by the checkbox under this list.
   */
  permitted?: boolean;
}) {
  if (sources.length === 0) return null;

  const suppliesImages = (source: DetectedSource) => source.images || permitted;
  const imageCount = sources.filter(suppliesImages).length;
  const textOnly = sources.length - imageCount;

  return (
    <div className="bg-muted/50 flex flex-col gap-1.5 rounded-md p-2.5">
      <span className="text-xs font-medium">
        Claude sẽ đọc {sources.length} nguồn trước khi viết
        {imageCount > 0 && `, ${imageCount} trong đó là nguồn ảnh`}:
      </span>

      {sources.map((source) => (
        <span key={source.url} className="flex min-w-0 items-center gap-1.5">
          {suppliesImages(source) ? (
            <ImageIcon className="text-primary size-3 shrink-0" />
          ) : (
            <FileTextIcon className="text-muted-foreground size-3 shrink-0" />
          )}
          <span className="text-muted-foreground min-w-0 truncate font-mono text-[11px]">
            {source.url}
          </span>
          <span
            className={
              suppliesImages(source)
                ? 'text-primary shrink-0 text-[10px] font-medium'
                : 'text-muted-foreground shrink-0 text-[10px]'
            }
          >
            {source.images ? 'lấy ảnh' : permitted ? 'lấy ảnh (được phép)' : 'chỉ lấy dữ kiện'}
          </span>
        </span>
      ))}

      {textOnly > 0 && (
        <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
          Ảnh trên báo và trang tin thuộc bản quyền của toà soạn - đăng lại trên YouTube mà
          không được phép là nhận gậy bản quyền. Những link đó được đọc để lấy dữ kiện; ảnh
          của video lấy từ nguồn giấy phép mở. Nếu đã xin phép toà soạn, tích ô bên dưới.
        </p>
      )}
    </div>
  );
}
