# Video Generator Pipelines

Hai dây chuyền làm video trong cùng một engine.

| | **Podcast** | **Fact Shorts** |
|---|---|---|
| Kết quả | MP4 dài 5-10 phút | MP4 dài 30-60 giây |
| Khung hình | 1920x1080 (ngang) | 1080x1920 (dọc) |
| Lời đọc | tiếng Anh | tiếng Việt |
| Phụ đề | song ngữ Anh + Việt | một dòng tiếng Việt |
| Giọng | Edge TTS (`en-US-AriaNeural`) | VieNeu-TTS chạy máy (`Thanh Bình`) |
| Ảnh nền | thư viện chung do bạn tải lên | tự tìm trên Openverse khi dựng |
| Đăng lên | kênh YouTube riêng, mỗi 8 giờ | kênh YouTube riêng, mỗi 2 giờ |

Hai module dùng chung khoảng hai phần ba code, nhưng **không dùng chung dữ liệu
và không dùng chung tài khoản YouTube**: mỗi bên có thư mục `runtime/` riêng,
file `.env` riêng và OAuth client riêng.

## Cài đặt

```bash
nvm use                 # Node 22 (bắt buộc: sharp và Remotion)
npm install
npm run setup:python    # venv + edge-tts (podcast, và fallback cho fact)
npm run setup:vieneu    # venv + VieNeu-TTS (fact)
```

Rồi tạo cấu hình:

```bash
cp .env.example .env
cp .env.podcast.example .env.podcast
cp .env.fact.example .env.fact
```

`.env` giữ những gì hai bên dùng chung; `.env.<module>` giữ phần riêng và **ghi
đè** lên `.env`. Điền `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` riêng cho
từng module — đó là hai kênh khác nhau.

## Chạy

```bash
npm run ui                                   # giao diện web, cả hai module, cổng 4000
npm run podcast -- generate <project>        # dựng một tập podcast
npm run fact    -- generate <project>        # dựng một video fact
```

Trên giao diện web, mỗi dự án có **một nút "Bắt đầu" chạy hết mọi việc**:

```
Ý tưởng → Kịch bản → Ảnh → Giọng đọc → Dựng video → Kiểm tra → Đăng YouTube
```

Màn hình dự án vẽ đúng bảy bước đó thành các ô nối nhau bằng mũi tên: ô đang
làm thì sáng lên và mũi tên dẫn vào nó chạy, ô đã xong hiện dấu tích kèm một
dòng cho biết nó tạo ra cái gì, bước dựng video có thanh tiến độ đếm khung
hình. Chọn nhiều dự án rồi bấm "Chạy tất cả" thì chúng chạy lần lượt.

> ⚠️ **Bước cuối đăng lên YouTube theo ô "Sau khi dựng xong" của từng dự án, và
> ô đó mặc định là "Lên lịch".** Nghĩa là một dự án chưa ai chỉnh sẽ *tự đăng*
> khi chạy xong. Đây là hành vi có từ trước, nút "Bắt đầu" chỉ làm nó dễ chạm
> tới hơn. Đổi sang "Không đăng" nếu muốn dừng ở bước dựng.

Không có module mặc định. Đây là chủ ý: hai bên có thư mục công việc, bộ nhớ
đệm và **thông tin đăng nhập YouTube khác nhau**, nên đoán sai module nghĩa là
chạy nhầm dây chuyền và đăng nhầm kênh.

Xem toàn bộ lệnh của một module:

```bash
npm run podcast -- --help
npm run fact -- --help
```

### Sửa giao diện

Giao diện nằm trong `ui/` (React + Tailwind + shadcn/ui), build bằng Vite ra
`server/public/`:

```bash
npm run ui:dev      # dev server có hot reload, cổng 5173, tự proxy API sang 4000
npm run ui:build    # build ra server/public/ để `npm run ui` phục vụ
```

`server/public/` là **kết quả build**, không phải mã nguồn — sửa trực tiếp ở đó
sẽ mất khi build lần sau.

### Vòng lặp nhanh khi sửa code

```bash
npm run typecheck
npm run podcast -- generate <project> --mock-tts --no-publish --force
npm run fact    -- generate <project> --mock-tts --no-publish --force
```

`--mock-tts` dùng audio câm nhưng đúng độ dài thật (theo tốc độ đọc đã đo của
từng module), nên bố cục kiểm tra được trong vài chục giây thay vì phải chờ
tổng hợp giọng. Video dựng bằng nó bị đánh dấu `devMock: true` và không được
đăng.

Vì phần lớn code giờ dùng chung, **hãy kiểm tra cả hai module** sau mỗi thay
đổi.

## Giao diện web

`npm run ui` mở một trang duy nhất cho cả hai dây chuyền, chuyển qua lại bằng ô
chọn ở góc trái trên. Lựa chọn nằm trong URL (`?m=podcast`, `?m=fact`) nên tải
lại trang hay gửi link cho người khác đều giữ đúng module.

Màn hình thư viện ảnh chỉ xuất hiện ở module Podcast — module Fact tự tìm ảnh
nên không có gì để quản lý.

## Tài liệu

- [CLAUDE.md](CLAUDE.md) — kiến trúc, ranh giới giữa hai module, và những quy
  tắc được bảo đảm bằng code chứ không bằng quy ước.
- [docs/modules/](docs/modules/) — ghi chú kỹ thuật gốc của từng module, giữ
  nguyên từ trước khi gộp: [podcast](docs/modules/podcast.md),
  [fact](docs/modules/fact.md), và hai bản hướng dẫn tiếng Việt đi kèm. Chúng có
  trước khi gộp, nên chỗ nào nói về bố cục hay cấu hình thì code hiện tại đúng
  hơn — nhưng *lý do* đằng sau từng con số đã tinh chỉnh thì nằm ở đó.
