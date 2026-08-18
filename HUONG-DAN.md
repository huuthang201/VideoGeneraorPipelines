# Hướng dẫn sử dụng

## Cài đặt (một lần duy nhất)

```bash
nvm use                 # Node 22, đọc từ .nvmrc
npm install
npm run setup:python    # tạo .venv + cài edge-tts cho giọng Việt
cp .env.example .env    # đã tạo sẵn, chỉ sửa nếu cần đổi đường dẫn/giọng
```

Kiểm tra máy sẵn sàng:

```bash
npm test && npm run typecheck
```

---

## Quy trình thường dùng

### 1. Bỏ ảnh vào folder

```
workspace/AI-Shorts/01_INPUT/ten-san-pham/
├── 01.jpg          ← tối thiểu 3 ảnh (.jpg .jpeg .png .webp)
├── 02.jpg
├── 03.jpg
└── info.json       ← không bắt buộc nhưng NÊN CÓ, xem mục dưới
```

Tên file quyết định thứ tự, nên đặt `01`, `02`, `03`.

### 2. Nạp project vào engine

```bash
npm run prepare:project -- workspace/AI-Shorts/01_INPUT/ten-san-pham
```

Bước này copy ảnh vào `runtime/jobs/`, xoay ảnh theo EXIF, resize, và tạo bản
preview 768px cho Claude đọc. Ảnh gốc trong `01_INPUT` **không bao giờ bị đụng
tới**.

### 3. Tạo video

```bash
npm run generate -- ten-san-pham
```

Xong. Video tự động được copy sang `workspace/AI-Shorts/03_OUTPUT/ten-san-pham/`:

```
video.mp4  thumbnail.jpg  storyboard.json  script.txt  captions.srt  job.json
```

Bản gốc vẫn nằm ở `runtime/jobs/ten-san-pham/output/` để bạn xem lại. Mất khoảng
60–110 giây, phần lớn là chờ Claude viết kịch bản.

Xem tình trạng mọi project:

```bash
npm run video-maker -- list
```
```
  DONE     baseus-ma10
  PENDING  san-pham-moi
```

---

## `info.json` — quan trọng hơn bạn nghĩ

Tất cả field đều tùy chọn, nhưng **những gì bạn không ghi vào đây thì Claude
không được phép nói ra**. Đó là quy tắc được cưỡng chế bằng code, không phải
bằng lời nhắc.

```json
{
  "name": "Baseus Bowie MA10",
  "category": "Tai nghe Bluetooth",
  "price": 399000,
  "currency": "VND",
  "features": ["Chống ồn ANC", "Bluetooth 5.3", "Thời lượng pin dài"],
  "targetAudience": ["Sinh viên", "Người đi làm"],
  "cta": "Xem sản phẩm ở link bên dưới"
}
```

- **Có `price`** → video được nhắc giá. Cho phép làm tròn trong khoảng 15%,
  nên "chưa tới 400 nghìn" cho hàng 399.000đ là hợp lệ.
- **Không có `price`** → chế độ nghiêm ngặt: cấm mọi con số, kể cả viết bằng
  chữ ("ba trăm chín chín nghìn").
- Bịa khuyến mãi, bảo hành, "chính hãng", "chứng nhận" → job **fail**, không
  ra video.

Càng ghi đủ vào `info.json` thì video càng có nội dung để nói.

---

## Sửa video mà không tốn lượt gọi Claude

Đây là chỗ tiết kiệm nhất. `storyboard.json` nằm trong
`runtime/jobs/ten-san-pham/`, sửa trực tiếp rồi:

```bash
npm run render -- ten-san-pham
```

Lệnh này **không gọi Claude, không gọi TTS** — chỉ dựng lại video. Dùng khi muốn
đổi animation, transition, style, thứ tự cảnh, hay chữ trên màn hình.

Nếu sửa cả `narration` (lời đọc) thì dùng `npm run generate -- ten-san-pham
--force`; TTS sẽ chạy lại cho phần text mới, phần cũ lấy từ cache.

Muốn Claude viết lại kịch bản từ đầu:

```bash
npm run regenerate -- ten-san-pham
```

---

## Các giá trị được phép trong `storyboard.json`

Claude chỉ được chọn trong danh sách này, bạn sửa tay cũng vậy:

| Trường | Giá trị |
|---|---|
| `type` | `hook` `product` `feature` `cta` — cảnh đầu phải `hook`, cảnh cuối phải `cta` |
| `animation` | `none` `zoom-in` `zoom-out` `pan-left` `pan-right` `pan-up` `pan-down` `fade` `spring` `slide-left` `slide-right` `slide-up` |
| `transition` | `cut` `fade` `slide` `whoosh` |
| `video.style` | `tiktok-fast` `modern-tech` `minimal` |
| `voice.voice` | `vi-VN-HoaiMyNeural` (nữ) `vi-VN-NamMinhNeural` (nam) |

`duration` chỉ là gợi ý — độ dài thật luôn tính từ giọng đọc, nên sửa nó không
có tác dụng.

---

## Lệnh đầy đủ

```bash
npm run prepare:project -- <đường-dẫn-folder-ảnh>
npm run generate        -- <id> [--force] [--mock-tts]
npm run render          -- <id>          # 0 Claude, 0 TTS
npm run regenerate      -- <id>          # gọi lại Claude
npm run generate-all                     # tất cả project trong runtime/jobs
npm run video-maker -- list              # project nào xong, project nào chưa
npm run video-maker -- publish <id>      # copy thủ công sang 03_OUTPUT
npm run check           -- <file.mp4>    # kiểm tra một file output
npm run studio                           # mở Remotion Studio để xem trực quan
```

**`--no-publish`**: giữ kết quả trong `runtime/jobs`, không copy sang
`03_OUTPUT`. Dùng khi còn đang thử nghiệm. Video chạy bằng `--mock-tts` **không
bao giờ** được publish, kể cả khi bạn không đặt cờ này.

**`--force`**: chạy lại dù input không đổi. Không có cờ này, chạy lần hai trên
project không đổi sẽ bỏ qua trong dưới 1 giây.

**`--mock-tts`**: chạy toàn bộ pipeline offline với giọng giả (im lặng). Dùng để
thử animation/layout khi không có mạng, hoặc khi Edge TTS đang lỗi. Video tạo ra
bị đóng dấu `devMock: true` trong `job.json` — **không được đem đăng**.

---

## Khi có lỗi

Xem `workspace/AI-Shorts/99_ERROR/<id>/error.json`:

```json
{
  "projectId": "ten-san-pham",
  "stage": "process-images",
  "code": "MINIMUM_IMAGES_NOT_MET",
  "message": "Expected at least 3 usable images, found 2"
}
```

File này tự xoá khi project chạy lại thành công. Log chi tiết ở
`runtime/logs/YYYY-MM-DD.jsonl`.

Vài mã lỗi hay gặp:

| Mã | Nghĩa | Cách xử lý |
|---|---|---|
| `MINIMUM_IMAGES_NOT_MET` | dưới 3 ảnh đọc được | thêm ảnh, hoặc kiểm tra ảnh hỏng |
| `AI_FACT_VIOLATION` | Claude bịa thông tin sau 2 lượt | bổ sung `info.json` cho đầy đủ |
| `TTS_GENERATION_FAILED` | Edge TTS không phản hồi | thử lại sau, hoặc dùng `--mock-tts` để làm tiếp phần hình |
| `OUTPUT_SILENT_AUDIO` | video ra không có tiếng | thường do TTS lỗi ngầm; xem log |

Một project fail **không** làm dừng các project khác khi chạy `generate-all`.

---

## Chuyển sang Google Drive

Engine không biết Drive là gì — nó chỉ đọc `runtime/jobs/`. Khi bạn cài Google
Drive for Desktop, chỉ cần sửa một dòng trong `.env`:

```
DRIVE_ROOT=/Users/hiut20/Library/CloudStorage/GoogleDrive-.../AI-Shorts
```

Không phải sửa dòng code nào.

---

## Nhạc nền

`assets/music/` và `assets/sfx/` đang trống. Bỏ file nhạc của bạn vào đó là
video sẽ có nhạc, và nhạc tự động nhỏ lại khi có giọng đọc. Tool cố tình không
tự tải nhạc từ Internet để tránh vấn đề bản quyền.
