# Hướng dẫn sử dụng

Tool này biến **một thư viện ảnh cảnh** thành video podcast dài **5-10 phút**,
lời đọc **tiếng Anh**, giọng nữ trẻ nhẹ nhàng. Claude viết kịch bản; mọi bước
sau đó chạy tự động và luôn cho ra cùng một kết quả.

Giao diện và hướng dẫn bằng tiếng Việt, còn **nội dung video thì bằng tiếng
Anh** — người dùng tool và người xem video là hai đối tượng khác nhau.

## Cài đặt (một lần duy nhất)

```bash
nvm use                 # Node 22, đọc từ .nvmrc
npm install
npm run setup:python    # tạo .venv + cài edge-tts
cp .env.example .env    # đã tạo sẵn, chỉ sửa nếu cần đổi đường dẫn/giọng
```

Kiểm tra máy sẵn sàng:

```bash
npm run typecheck
```

---

## Chọn giọng đọc — nên làm trước tiên

Tên giọng không nói lên điều gì; phải nghe mới biết. Lệnh sau đọc **cùng một
đoạn** bằng tất cả các giọng trong danh sách rút gọn, ghi ra
`runtime/voice-samples/`:

```bash
npm run tts:sample
```

Danh sách được chọn theo **nhãn tính cách do chính dịch vụ gắn**, không phải
theo tên — trong toàn bộ giọng nữ tiếng Anh chỉ vài giọng được gắn nhãn khác
"Friendly, Positive" mặc định:

| Giọng | Nhãn của dịch vụ |
|---|---|
| `en-US-AriaNeural` | News, **Novel** — chất kể chuyện. Đang để mặc định |
| `en-US-MichelleNeural` | News, Novel — ấm hơn Aria một chút |
| `en-US-EmmaMultilingualNeural` | Conversation — **Cheerful, Clear** |
| `en-US-AvaMultilingualNeural` | Conversation — **Expressive**, Caring, Pleasant |
| `en-GB-LibbyNeural` | giọng Anh người lớn nghe trẻ nhất |
| `en-GB-SoniaNeural` | Anh, rõ chữ; nâng pitch để trẻ hơn |
| `en-IE-EmilyNeural` / `en-SG-LunaNeural` | Ireland và Singapore, nhẹ và trẻ |
| `en-US-AnaNeural` | Cartoon — **Cute**, giọng trẻ em thật. Chọn nhầm là hỏng: đọc dài hơn một câu là chữ nhoè |

Đoạn đọc thử kiểm tra cả hai thứ một giọng có thể hỏng: ngữ điệu (câu hỏi, câu
bẻ ngang, câu kết hạ giọng) và **nhả chữ** (cụm phụ âm, con số, danh sách bốn
món). Chỉ giọng tiếng Anh mới được dùng — `isEnglishVoice` chặn ngay từ đầu
nếu đặt giọng locale khác.

Nghe xong, đổi `TTS_VOICE` trong `.env`. Muốn xem toàn bộ giọng tiếng Anh mà
dịch vụ có: `npm run tts:voices`.

**Tốc độ đọc** nằm ở `TTS_RATE`. Đo thật trên một đoạn 600 từ với giọng mặc
định:

| Giọng | `TTS_RATE` | Nhịp đọc | Tập 1187 từ |
|---|---|---|---|
| `en-US-AriaNeural` | `-20%` | 139 từ/phút — mặc định | 8,5 phút |
| `en-US-AriaNeural` | `-10%` | 157 từ/phút | 7,6 phút |
| `en-US-AriaNeural` | `+0%` | 174 từ/phút | 6,8 phút |
| `en-US-AnaNeural` | `-20%` | 120 từ/phút | 9,9 phút |

Đọc dòng đầu với dòng cuối: cùng `-20%` mà hai giọng chênh gần một nấc tốc độ —
**chọn giọng trước, chỉnh tốc độ sau**. 139 từ/phút là thong thả chứ không chậm
(sách nói chuẩn là 150-160).

Ba nút, ba việc khác nhau: `TTS_RATE` là nhịp, `TTS_PITCH=+18Hz` là độ trẻ, còn
`TTS_VOLUME=-15%` mới là thứ "soft" thật sự — hạ vài decibel làm mất cái gắt mà
không làm nhoè chữ. Nếu bạn đổi con số này thì phải sửa cả
`WORDS_PER_MINUTE` trong `src/domain/config.ts`, vì số từ của kịch bản được tính
từ đó — để nguyên sẽ ra video ngắn hơn độ dài đã đặt vài phút.

---

## Quy trình thường dùng

### 1. Nạp ảnh vào thư viện chung (làm một lần, dùng cho mọi dự án)

Hệ thống có **một thư viện ảnh dùng chung** ở `runtime/library` (đổi được bằng
`LIBRARY_DIR` trong `.env`): ảnh cảnh toàn khung hình — phong cảnh, quán cà phê,
mưa, bầu trời đêm...

Dự án **không có ảnh riêng**: mọi dự án đều lấy ảnh từ thư viện này.

```bash
npx tsx src/cli/index.ts library add-environments ~/anh/boi-canh
npx tsx src/cli/index.ts library list
npx tsx src/cli/index.ts library remove-environment 01_bien.jpg
```

Một tập 5-10 phút gồm khoảng 10-20 cảnh, nên thư viện nên có **từ 8 ảnh trở
lên**; ít hơn thì cùng một ảnh sẽ lặp lại nhiều lần và video trông như bị đứng.
Khung mặc định là 16:9 nên **ảnh ngang là hợp nhất**; ảnh dọc vẫn dùng được
nhưng sẽ hiện thu nhỏ giữa khung với hai bên là chính nó được làm mờ.

### 2. Tạo dự án

Cách nhanh nhất là mở giao diện web:

```bash
npm run ui              # http://localhost:4000
```

Trong màn hình dự án, điền:

- **Chủ đề** — điều quan trọng nhất. Viết bằng tiếng Anh hoặc tiếng Việt đều
  được, nhưng lời đọc luôn ra tiếng Anh. Càng cụ thể càng tốt: "a slow walk
  through Hanoi's Old Quarter before sunrise" dùng được, còn "thiên nhiên" thì
  không.
- **Câu mở đầu** — nếu bạn có sẵn ý cho một phút đầu. Để trống cũng được.
- **Độ dài mong muốn (phút)** — 5 đến 10. Để trống thì lấy
  `VIDEO_TARGET_DURATION` trong `.env` (mặc định 7 phút).

Nút **"Gợi ý từ ảnh"** cho Claude xem thư viện rồi đề xuất sẵn chủ đề và câu mở
đầu; bạn sửa lại thoải mái trước khi tạo kịch bản.

Hoặc làm bằng dòng lệnh:

```bash
npx tsx src/cli/index.ts prepare ./workspace/AI-Shorts/01_INPUT/rain-episode
npx tsx src/cli/index.ts suggest-brief rain-episode
```

### 3. Tạo kịch bản, rồi tạo video

Trong giao diện: bấm **"Tạo kịch bản"**, đọc lại, rồi bấm **"Tạo video"**. Bằng
dòng lệnh:

```bash
npx tsx src/cli/index.ts generate-storyboard rain-episode   # chỉ kịch bản
npx tsx src/cli/index.ts generate rain-episode              # trọn gói
```

**Hãy kiên nhẫn.** Viết một kịch bản 1500 từ mất vài phút; đọc thành tiếng 7
phút cũng mất vài phút; dựng hình lại vài phút nữa. Đây là chuyện bình thường,
không phải treo máy.

Muốn thử bố cục mà không tốn thời gian chờ giọng đọc:

```bash
npx tsx src/cli/index.ts generate rain-episode --mock-tts --no-publish
```

Video ra sẽ **im lặng** nhưng bố cục là thật, và bị đóng dấu `devMock: true` để
không bao giờ bị đem đăng nhầm.

---

## Sau khi dựng xong: gói đăng YouTube

Render xong, mục **"Đăng lên YouTube"** hiện ra trong màn hình dự án, và hai file
được ghi vào `output/`:

| File | Dùng để |
|---|---|
| `youtube.md` | đọc và copy tay |
| `youtube.json` | cho script tự động sau này |

Gồm có:

- **Tiêu đề** — kèm bộ đếm ký tự (YouTube cắt quanh 60, chặn ở 100)
- **Mô tả** — vài đoạn giới thiệu, rồi **danh sách chương có mốc thời gian thật**
  lấy từ timeline, rồi **dòng ghi nguồn nhạc**
- **Tags** — 5-12 từ khoá
- **3 ảnh thumbnail** để chọn: một ảnh bìa mở đầu và hai ảnh lấy từ giữa tập

Hai thứ **hệ thống tự sinh, không phải Claude viết**: mốc chương (đo từ video
thật) và dòng ghi nguồn nhạc (đọc từ `assets/music/credits.json`). Nhạc CC BY
**bắt buộc ghi tên tác giả** — đừng xoá dòng đó khi dán lên YouTube.

Chương mục có ba luật ngầm của YouTube mà nó không báo lỗi, chỉ lặng lẽ bỏ qua
cả danh sách nếu vi phạm: mốc đầu phải là `0:00`, tối thiểu 3 chương, mỗi chương
cách nhau ít nhất 10 giây. Code đã lo cả ba.

### Tải thẳng lên YouTube (tuỳ chọn)

Bật lên thì có nút **"Tải lên YouTube"** ngay dưới phần thumbnail: một cú bấm là
video lên kênh kèm sẵn tiêu đề, mô tả, chương mục và tags.

**Phải biết trước:** Google **ép mọi video upload qua API về chế độ riêng tư**
nếu project chưa qua kiểm duyệt của họ (mọi project tạo sau 28/07/2020). Nút này
lo phần chán nhất — đẩy hơn 100 MB và dán mô tả 13 chương — còn anh vào YouTube
Studio bật công khai. Muốn công khai thẳng thì phải nộp project cho Google audit.

Cài một lần:

1. [console.cloud.google.com](https://console.cloud.google.com) → tạo project →
   bật **YouTube Data API v3**
2. **Credentials** → *Create OAuth client ID* → chọn **Desktop app**

   Nếu lỡ chọn **Web application** thì phải thêm đúng dòng này vào mục
   *Authorized redirect URIs*, nếu không sẽ dính `Error 400: redirect_uri_mismatch`:

   ```
   http://localhost:4180
   ```

   (Client loại Web chỉ chấp nhận redirect URI đã đăng ký trước; loại Desktop
   thì chấp nhận mọi cổng loopback. Cổng đổi được bằng `YOUTUBE_REDIRECT_PORT`,
   nhưng đổi thì phải sửa cả trong Google Console.)
3. **OAuth consent screen** → thêm chính email của anh vào **Test users**
4. Dán `YOUTUBE_CLIENT_ID` và `YOUTUBE_CLIENT_SECRET` vào `.env`
5. Chạy một lần, trình duyệt sẽ mở ra để anh bấm đồng ý:

```bash
npx tsx src/cli/index.ts youtube-auth
```

**Tiêu đề tự động thêm tiền tố** `[Eng + Vietsub]` — đổi hoặc bỏ trong `.env`:

```
YOUTUBE_TITLE_PREFIX=[Eng + Vietsub]
```

Khoảng trắng ngăn cách được thêm tự động (không cần đặt trong nháy). Nếu tiêu đề
cộng tiền tố vượt 100 ký tự — mức YouTube chặn — thì phần tiêu đề bị cắt ở ranh
giới từ, tiền tố luôn được giữ.

Đổi tiền tố xong, cập nhật lại các tập **đã dựng** mà không phải render lại:

```bash
npx tsx src/cli/index.ts publish-kit <id>
```

Dự án nào đã tải lên YouTube sẽ có **nhãn đỏ ▶ YouTube** ở góc thẻ ngoài màn hình
chính, bấm vào là mở thẳng video.

### Lên lịch đăng, mỗi tập cách nhau 3 giờ

Có **hai chỗ** lên lịch được, cho hai tình huống khác nhau:

- **Video đã dựng xong rồi** → mục *Đăng lên YouTube*, ô **Chế độ** chọn
  *"Lên lịch → giờ cụ thể"* rồi bấm **Tải lên & hẹn giờ**.
- **Video sắp dựng** → mục *Video*, chọn trước rồi bấm *Tạo video*; dựng xong nó
  tự tải lên theo lựa chọn đó.

Hai chỗ dùng chung một hàng đợi, tập nào tải lên trước thì lấy slot trước.

**Bấm tải lên nhiều tập cùng lúc thì sao?** Cứ bấm thoải mái — server **tải lên
lần lượt từng tập một**, không chạy song song. Mỗi tập ~120 MB, mười lăm tập
cùng lúc là 1,8 GB tranh nhau một đường lên: tất cả cùng chậm, và tập nào hỏng
giữa chừng là mất trắng phần đã gửi. Xếp hàng thì tổng thời gian y hệt, nhưng
tập đầu tiên xong sau hai phút thay vì phải chờ cả mẻ.

Khi bấm mà đang có tập khác tải, toast sẽ báo *"Đã xếp hàng — còn N tập đang tải
trước"*.

Trong mục **Video** của mỗi dự án có ba lựa chọn cho lúc dựng xong:

| Chọn | Kết quả |
|---|---|
| **Không đăng** | dựng xong thì dừng, tải lên bằng tay sau |
| **Đăng luôn** | dựng xong là tải lên ngay |
| **Lên lịch** | tải lên và hẹn giờ công khai theo hàng đợi |

Hàng đợi hoạt động như sau: hệ thống giữ một mốc `a`. Tập đầu tiên lên lịch sẽ
đăng vào **a + 8 giờ**, rồi `a` nhảy tới đúng giờ đó. Tập sau lấy tiếp a + 8 giờ.
Xếp 10 tập trong một buổi chiều thì chúng lần lượt lên sóng cách nhau 8 tiếng,
chứ không đổ hết cùng lúc vào feed người theo dõi.

Nếu `a` đã trôi vào quá khứ (mấy hôm không đăng gì) thì nó **được kéo về hiện
tại** trước khi cộng — chứ không phải xả một loạt video ngay lập tức.

Xem và chỉnh mốc:

```bash
npx tsx src/cli/index.ts schedule                    # xem tập tới sẽ đăng lúc nào
npx tsx src/cli/index.ts schedule --reset now        # kéo mốc về hiện tại
npx tsx src/cli/index.ts schedule --reset 2026-09-01T08:00:00
```

Khoảng cách đổi trong `.env`: `SCHEDULE_INTERVAL_HOURS=8` (8 giờ = tối đa 3
video/ngày). Đây là **trần**, không phải chỉ tiêu: YouTube giới hạn lượng đề xuất
trên mỗi kênh mỗi ngày, nên nhiều video đăng sát nhau sẽ chia nhau cùng một suất
hiển thị chứ không cộng dồn.

Slot tính từ **lúc xếp hàng**, nên nếu bấm lúc 3 giờ sáng thì các slot cũng rơi
vào giờ xấu. Kéo mốc về giờ đẹp trước khi xếp một đợt:

```bash
# muốn tập đầu lên lúc 12:00 trưa mai, với khoảng cách 8 giờ:
npx tsx src/cli/index.ts schedule --reset 2026-08-24T04:00:00
```

**Lưu ý quan trọng:** YouTube chỉ nhận `publishAt` khi video ở chế độ private —
điều này khớp sẵn với việc project chưa audit bị ép private. Nhưng **trước khi
audit xong, lịch có thể không tự bật công khai đúng giờ**. Video vẫn lên kênh
kèm giờ hẹn ghi trong Studio; anh kiểm lại ở đó.

Từ đó bấm nút trong UI, hoặc dùng dòng lệnh:

```bash
npx tsx src/cli/index.ts youtube-upload <id> --privacy unlisted
npx tsx src/cli/index.ts youtube-upload <id> --schedule      # lấy slot kế tiếp
```

**Hệ thống biết đẩy lên kênh nào?** Qua bước cấp quyền: Google hiện màn hình
chọn tài khoản, và nếu tài khoản đó có nhiều kênh (Brand Account) thì hiện luôn
màn hình chọn kênh. Token gắn với kênh anh chọn ở đó — lệnh upload **không** có
tham số chỉ định kênh.

Xem đang trỏ vào kênh nào:

```bash
npx tsx src/cli/index.ts youtube-channel
```

Tên kênh cũng hiện sẵn ngay cạnh nút trong UI. Muốn đổi sang kênh khác:

```bash
npx tsx src/cli/index.ts youtube-logout
npx tsx src/cli/index.ts youtube-auth
```

Nếu Google bỏ qua màn hình chọn tài khoản (nhớ lựa chọn cũ), vào
[myaccount.google.com/permissions](https://myaccount.google.com/permissions) gỡ
app ra rồi cấp quyền lại.

Vài lưu ý:

- Consent screen để ở chế độ **Testing** thì token hết hạn sau **7 ngày** — chạy
  lại `youtube-auth`. Chuyển sang *Published* thì không bị.
- **Thumbnail chỉ đặt được nếu kênh đã xác minh số điện thoại.** Không có thì
  video vẫn lên bình thường, chỉ báo một dòng cảnh báo.
- Từ 6/2026 quota upload tách riêng, mặc định ~100 video/ngày — không phải lo.
- Token nằm ở `runtime/youtube-token.json`, đã gitignore. Muốn thu hồi thì xoá
  file đó và gỡ quyền ở [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

---

## Khung ngang hay khung dọc

```bash
VIDEO_ASPECT=landscape   # 1920x1080 — mặc định, hợp YouTube
VIDEO_ASPECT=portrait    # 1080x1920 — hợp Shorts/TikTok
```

Bố cục tự thích ứng: cỡ chữ, lề an toàn và cách ghép ảnh đều tính từ khung hình
thật. Đổi giá trị này rồi chạy `generate <id> --force` là dựng lại tập cũ theo
khung mới — **không cần** tạo lại kịch bản.

---

## `info.json` — chỉ cần khi tập nói về thông tin kiểm chứng được

Phần lớn tập podcast (mưa, biển, một nghề thủ công, một câu chuyện) **không cần
file này**. Chỉ tạo nó khi tập nói về một thứ có số liệu cụ thể mà bạn muốn
khoá lại:

```json
{
  "name": "Baseus Bowie MA10",
  "category": "Wireless earbuds",
  "price": 399000,
  "currency": "VND",
  "features": ["Active noise cancelling", "Bluetooth 5.3"]
}
```

Có file này thì **những gì không ghi trong đó, Claude không được nói** — số
liệu, giá, bảo hành, khuyến mãi, "được chứng nhận"... đều bị chặn bằng code chứ
không phải bằng lời nhắc. Không có file này thì bộ chặn nghỉ, vì một bài kể
chuyện tự nhiên có quyền nói "khoảng mười phút" hay "năm 1969".

---

## Sửa video mà không tốn lượt gọi Claude

`storyboard.json` nằm trong `runtime/jobs/<id>/`. Sửa trực tiếp rồi:

```bash
npm run render -- rain-episode
```

Lệnh này **không gọi Claude, không gọi TTS** — chỉ dựng lại video. Dùng khi muốn
đổi ảnh nền, chuyển động, style, thứ tự cảnh hay chữ tiêu đề.

Nếu sửa cả `narration` (lời đọc) thì dùng `npm run generate -- rain-episode
--force`; TTS chạy lại cho phần text mới, phần cũ lấy từ cache.

Muốn Claude viết lại từ đầu:

```bash
npm run regenerate -- rain-episode
```

Mỗi lần tạo lại, bản cũ được lưu vào `storyboard-versions/` và giao diện cho
phép quay về bản trước — nên tạo lại không bao giờ mất bản đang có.

---

## Các giá trị được phép trong `storyboard.json`

Claude chỉ được chọn trong danh sách này, bạn sửa tay cũng vậy:

| Trường | Giá trị |
|---|---|
| `type` | `intro` `segment` `outro` — cảnh đầu phải `intro`, cảnh cuối phải `outro` |
| `environment` | tên file trong thư viện chung (bắt buộc, mỗi cảnh một ảnh) |
| `title` | chữ hiện trên màn hình, tối đa 60 ký tự; để `""` nếu cảnh không cần tiêu đề |
| `narration` | đoạn được đọc, tối đa 700 ký tự (~45 giây) |
| `narrationVi` | bản tiếng Việt của đoạn đó — dòng phụ đề thứ hai |
| `animation` | `none` `drift` `zoom-in` `zoom-out` `pan-left` `pan-right` `pan-up` `pan-down` |
| `transition` | `fade` `cut` |
| `effect` | `none` `vignette` |
| `overlay` | `none` `dust` `bokeh` `rain` `light-sweep` — element chuyển động phủ lên ảnh |
| `video.style` | `calm` (ban ngày) · `warm` (hổ phách, kể chuyện) · `night` (tối, yên) |
| `voice.voice` | tên giọng Edge, ví dụ `en-US-AvaNeural` |

Cả bộ từ vựng đều **chậm và nhẹ** — không có rung máy, loé sáng hay chữ bay
vào. Một tập podcast dài 10 phút mà giật cục thì thành lỗi chứ không thành hiệu
ứng.

`duration` chỉ là ước lượng — độ dài thật luôn tính từ giọng đọc, nên sửa nó
không có tác dụng.

---

## Lệnh đầy đủ

```bash
npx tsx src/cli/index.ts library add-environments <folder-ảnh>
npx tsx src/cli/index.ts library list
npx tsx src/cli/index.ts library remove-environment <tên-file>
npm run prepare:project -- <folder-có-info.json/brief.json>
npx tsx src/cli/index.ts suggest-brief      <id>
npx tsx src/cli/index.ts generate-storyboard <id>   # chỉ kịch bản
npm run generate        -- <id> [--force] [--mock-tts] [--voice <tên-giọng>]
npm run render          -- <id>          # 0 Claude, 0 TTS
npm run regenerate      -- <id>          # gọi lại Claude
npm run generate-all                     # tất cả project trong runtime/jobs
npx tsx src/cli/index.ts list            # project nào xong, project nào chưa
npx tsx src/cli/index.ts publish <id>    # copy thủ công sang 03_OUTPUT
npm run check           -- <file.mp4>    # kiểm tra một file output
npm run tts:sample                       # nghe thử các giọng
npm run studio                           # mở Remotion Studio để xem trực quan
```

**`--no-publish`**: giữ kết quả trong `runtime/jobs`, không copy sang
`03_OUTPUT`. Video chạy bằng `--mock-tts` **không bao giờ** được publish, kể cả
khi bạn không đặt cờ này.

**`--force`**: chạy lại dù input không đổi. Không có cờ này, chạy lần hai trên
project không đổi sẽ bỏ qua trong dưới 1 giây.

**`--voice`**: đổi giọng cho riêng lần chạy đó, không phải sửa `.env`.

---

## Khi có lỗi

Xem `workspace/AI-Shorts/99_ERROR/<id>/error.json`:

```json
{
  "projectId": "rain-episode",
  "stage": "process-images",
  "code": "MINIMUM_IMAGES_NOT_MET",
  "message": "The shared library needs at least 1 backdrop image."
}
```

File này tự xoá khi project chạy lại thành công. Log chi tiết ở
`runtime/logs/YYYY-MM-DD.jsonl`.

Vài mã lỗi hay gặp:

| Mã | Nghĩa | Cách xử lý |
|---|---|---|
| `MINIMUM_IMAGES_NOT_MET` | thư viện chung chưa có ảnh nào | `library add-environments` |
| `AI_FACT_VIOLATION` | Claude không viết được bản đạt yêu cầu sau 3 lượt — thường là **kịch bản quá ngắn** so với độ dài đã đặt | giảm "độ dài mong muốn", hoặc viết chủ đề cụ thể hơn để có nhiều thứ để nói |
| `TTS_GENERATION_FAILED` | Edge TTS không phản hồi | thử lại sau, hoặc `--mock-tts` để làm tiếp phần hình |
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

Thả file `.mp3` vào `assets/music/` là tập sau có nhạc; dọn sạch thư mục là hết
nhạc. Nhạc **tự động nhỏ xuống khi có giọng đọc** và to lại ở quãng nghỉ —
không phải chỉnh gì.

```
MUSIC_FILE=            # để trống = lấy file đầu tiên theo thứ tự chữ cái
MUSIC_VOLUME=0.12      # mức ở quãng nghỉ; lúc đang đọc còn thấp hơn nhiều
```

Sẵn có hai bài **CC BY 3.0** (dùng thương mại được, **phải ghi tên tác giả**
trong phần mô tả video) — xem `assets/music/CREDITS.md`.

Muốn dùng nhạc **YouTube Audio Library** (không cần ghi nguồn) thì anh tự tải
về rồi copy vào thư mục đó: kho của họ chỉ cho tải khi đã đăng nhập YouTube.
