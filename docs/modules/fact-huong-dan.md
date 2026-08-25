# Hướng dẫn sử dụng

Tool này biến **một câu mô tả sự thật** thành video ngắn dạng **fact**: dài
**30-60 giây**, khung dọc **9:16**, lời đọc **tiếng Việt** bằng giọng nam miền
Bắc, và đăng lên YouTube Shorts **theo lịch tự động**. Claude viết
kịch bản; mọi bước sau đó chạy tự động — **kể cả việc đi tìm ảnh nền**.

Bạn không phải chuẩn bị ảnh, không phải quay gì, không phải đăng ký tài khoản
nào ngoài YouTube.

Giao diện, hướng dẫn và nội dung video đều bằng tiếng Việt.

## Cài đặt (một lần duy nhất)

```bash
nvm use                 # Node 22, đọc từ .nvmrc
npm install
npm run setup:vieneu    # tạo .venv-vieneu + tải model giọng đọc
cp .env.example .env    # rồi sửa nếu cần đổi đường dẫn/giọng
```

Kiểm tra máy sẵn sàng:

```bash
npm run typecheck
```

---

## Giọng đọc

Máy đang chạy **VieNeu-TTS** ngay tại chỗ (không cần mạng, không cần API key),
có **19 giọng** đủ ba miền. Tên giọng không cho biết vùng miền, nên phải xem
nhãn:

| Giọng | |
|---|---|
| `Thanh Bình` | nam · miền **Bắc** · kể chuyện — **đang để mặc định** |
| `Thái Sơn` | nam · miền **Nam** · kể chuyện |
| `Phạm Tuyên` | nam · miền Bắc · tự nhiên |
| `Minh Đức` | nam · miền Bắc · tin tức |
| `Ngọc Linh` | nữ · miền Bắc · kể chuyện |

Xem đủ 19 giọng: `npm run tts:voices`. Nghe thử: `npm run tts:sample`.

**Đổi giọng thì phải đo lại nhịp đọc** — xem mục dưới. Giọng khác nhau chênh
nhau rất nhiều: cùng một đoạn ở cùng tốc độ, Thanh Bình đọc 318 từ/phút còn
Thái Sơn chỉ 248.

Vẫn giữ Edge TTS làm phương án dự phòng (`TTS_ENGINE=edge`), nhưng nó chỉ có 2
giọng Việt và phụ thuộc một endpoint không chính thức.

Đoạn đọc thử là **một video fact hoàn chỉnh** chứ không phải một câu trung tính,
vì một giọng có thể hỏng ở hai chỗ khác nhau: ngữ điệu (câu hook phải "ăn", dấu
gạch ngang phải thành một nhịp nghỉ thật, câu hỏi phải nhấc lên) và nhả chữ.
Tiếng Việt có thanh điệu, nên thứ cần nghe kỹ không phải là chữ có nhoè không,
mà là **thanh có rơi đúng chỗ không** — sai thanh là ra một từ khác hẳn.

### Tốc độ đọc

Nằm ở `TTS_SPEED` — kéo giãn thời gian bằng ffmpeg sau khi tổng hợp, nên **đọc
nhanh hơn mà không bị lên giọng chuột**. Đo trên giọng Thanh Bình:

| `TTS_SPEED` | Nhịp đọc |
|---|---|
| `1.0` | 268 từ/phút |
| `1.15` | **318 từ/phút** — đang để mặc định |
| `1.3` | 352 từ/phút |

"Từ" ở đây là **một tiếng** (tách theo khoảng trắng), nên đừng so con số này với
tiếng Anh.

**Ba thứ làm đổi nhịp đọc, và tốc độ là thứ ít quan trọng nhất:**

1. **Giọng** — chênh nhiều nhất. Cùng đoạn, cùng tốc độ: Thanh Bình 318 từ/phút,
   Thái Sơn 248.
2. **Dấu câu** — giọng máy nghỉ lâu sau dấu chấm, gần như không nghỉ ở dấu phẩy.
   Kịch bản viết câu ngắn rời rạc đọc chậm hơn kịch bản viết liền mạch khoảng
   20%. Prompt hiện yêu cầu viết liền mạch, và con số trên đo trên đúng kiểu đó.
3. **`TTS_SPEED`**.

**Đổi bất kỳ thứ nào trong ba cái đó thì phải đo lại và sửa `WORDS_PER_MINUTE`
trong `src/domain/config.ts`:**

```bash
npm run tts:pace
```

Số từ của kịch bản được tính từ hằng số đó. Để nguyên con số cũ thì video dài
sai — và **quá 60 giây là YouTube không tính là Short nữa**.

Phải đo trên **kịch bản thật**, không phải một đoạn văn xuôi.

---

## Quy trình thường dùng

### 1. Ảnh nền: không phải làm gì cả

Kịch bản sẽ tự khai báo hai đến bốn **từ khoá tìm ảnh bằng tiếng Anh**
(`"deep sea jellyfish"`, `"honey jar"`...), rồi hệ thống lên
[Openverse](https://openverse.org) — kho tìm ảnh giấy phép mở do WordPress vận
hành — tải ảnh về, cắt cho vừa khung dọc, và ghi tên tác giả ở góc khung hình.

**Không cần API key.** Đó chính là lý do chọn Openverse thay vì Pexels hay
Unsplash: hai kho kia ảnh đẹp hơn nhưng bắt đăng ký tài khoản.

Chỉ ba loại giấy phép được dùng: `CC0`, ảnh thuộc phạm vi công cộng, và `CC BY`.
Cả ba đều **cho dùng thương mại và cho phép sửa đổi**. Các giấy phép ShareAlike,
NonCommercial và NoDerivatives bị loại bằng code — ShareAlike đặc biệt nguy
hiểm vì có thể kéo theo cả video của bạn phải mang cùng giấy phép đó.

Hệ thống chỉ tìm trong các nguồn **ảnh chụp** (stocksnap, rawpixel, flickr,
nappy) và loại bỏ tranh khắc, bản in bảo tàng, ảnh tiêu bản — đổi trong
`STOCK_SOURCES` nếu cần. Truy vấn nào tìm được quá ít ảnh thì tự nới rộng, nhưng
ảnh nới rộng luôn xếp sau ảnh đúng chủ đề của truy vấn khác.

Sau khi tìm xong, **Claude mở từng ảnh ra xem** rồi mới quyết định ảnh nào vào
cảnh nào. Đây là bước duy nhất phán đoán bằng *hình* thay vì bằng *chữ* — vì chữ
không phân biệt được con chuột với con chuột máy tính, hay con vật với cái sọ của
nó trong bảo tàng.

Bước này chỉ mang tính gợi ý: cảnh nào nó bỏ qua thì hệ thống tự gán như cũ, và
nếu lượt gọi hỏng thì video vẫn dựng bình thường. Tắt bằng `IMAGE_REVIEW=off`
trong `.env.fact` — tiết kiệm một lượt gọi Claude và khoảng một phút mỗi video.

Muốn xem trước một từ khoá tìm ra ảnh gì, không tốn lượt dựng video:

```bash
npx tsx src/cli/index.ts stock-search "deep sea jellyfish"
```

Openverse cho **200 lượt tìm mỗi ngày** khi không đăng nhập. Một video tốn 2-4
lượt, nên kênh đăng 12 video/ngày dùng khoảng 50 lượt — dư nhiều. Ảnh tải về
được lưu ở `runtime/stock/`, nên dựng lại video cũ không tốn thêm lượt nào.

Nếu có ngày nào chạm trần, lệnh sẽ báo rõ và bạn chỉ cần chờ; hoặc lấy token
miễn phí của Openverse rồi điền vào `OPENVERSE_TOKEN` trong `.env`.

### 2. Tạo dự án

Cách nhanh nhất là mở giao diện web:

```bash
npm run ui              # http://localhost:4100
```

Trong màn hình dự án, điền:

- **Sự thật muốn kể** — quan trọng nhất. Càng cụ thể càng tốt: "mật ong không
  bao giờ hỏng, vì gần như không có nước nên vi khuẩn không sống được" thì viết
  được ngay; "về thiên nhiên" thì không.
- **Câu mở đầu** — hai giây đầu quyết định người xem ở lại hay vuốt qua, nên đây
  là câu đáng viết tay nhất. Để trống thì Claude tự viết.
- **Độ dài mong muốn (giây)** — điền sẵn **45 giây**, lấy từ
  `VIDEO_TARGET_DURATION` trong `.env`. Sửa được, khoảng cho phép là 15-90,
  nhưng nên giữ trong 30-60. Đặt trên 52 giây thì hệ thống tự kẹp xuống, vì
  kịch bản được phép dài hơn ngân sách 15% và quá 60 giây là mất tư cách Short.

Nút **"Gợi ý sự thật"** cho Claude đề xuất sẵn một sự thật và câu mở đầu.

Nó **bám theo tên dự án**: đặt tên là "con chuột" thì nó tìm một sự thật về
chuột. Nên tên dự án chính là chỗ bạn nói mình muốn nghe về cái gì. Tên không
mang nghĩa (kiểu "Dự án 2") thì nó bỏ qua và tự chọn chủ đề.

Nó cũng đọc tên các video đã có trong máy để không gợi ý trùng. Bạn sửa lại
thoải mái trước khi tạo kịch bản.

Hoặc làm bằng dòng lệnh:

```bash
npx tsx src/cli/index.ts prepare ./workspace/AI-Shorts/01_INPUT/mat-ong
npx tsx src/cli/index.ts suggest-brief mat-ong
```

### 3. Tạo kịch bản, rồi tạo video

Trong giao diện: bấm **"Tạo kịch bản"**, đọc lại, rồi bấm **"Tạo video"**. Bằng
dòng lệnh:

```bash
npx tsx src/cli/index.ts generate-storyboard mat-ong   # chỉ kịch bản
npx tsx src/cli/index.ts generate mat-ong              # trọn gói
```

Cả quy trình mất khoảng một phút rưỡi: Claude viết kịch bản, hệ thống đi tìm và
tải ảnh, VieNeu đọc, rồi Remotion dựng từng khung hình.

**Hãy đọc lại kịch bản trước khi dựng.** Đây là kênh fact: prompt đã yêu cầu rất
gắt là không được bịa số liệu, năm, tên nghiên cứu — nhưng không có đoạn code
nào kiểm tra được một sự thật có đúng hay không. Việc đó là của bạn.

Muốn thử bố cục mà không tốn thời gian chờ giọng đọc:

```bash
npx tsx src/cli/index.ts generate mat-ong --mock-tts --no-publish
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
| `youtube.json` | lệnh upload đọc file này |

Gồm có:

- **Tiêu đề** — kèm bộ đếm ký tự (YouTube chặn ở 100; khung Short chỉ hiện
  khoảng 60 ký tự đầu)
- **Mô tả** — vài câu, rồi **dòng hashtag** `#shorts` kèm vài thẻ của video, rồi
  **dòng ghi nguồn nhạc**
- **Tags** — 5-12 từ khoá
- **3 ảnh thumbnail** để chọn

Hai thứ **hệ thống tự sinh, không phải Claude viết**: dòng hashtag và dòng ghi
nguồn nhạc (đọc từ `assets/music/credits.json`). Nhạc CC BY **bắt buộc ghi tên
tác giả** — đừng xoá dòng đó.

Video ngắn **không có danh sách chương**: một video 45 giây mà chia ba chương
mười giây thì vô nghĩa, và nó chiếm mất đúng ba dòng mô tả mà người ta có đọc.
Chương chỉ được sinh cho video dài từ 2 phút trở lên.

**Không có chỗ nào khai báo với YouTube rằng đây là Short.** Không có nút, không
có trường nào trong API cả. YouTube tự nhận ra dựa trên hai thứ: khung hình
**9:16** và độ dài **dưới 60 giây**. `#shorts` chỉ giúp tìm kiếm chứ không quyết
định gì.

Vượt 60 giây là hỏng **âm thầm**: video vẫn tải lên thành công, vẫn hiện trên
kênh, chỉ là không bao giờ được đẩy vào feed Shorts. Và **không sửa được sau
đó** — video đã bị xếp loại là video thường thì có cắt ngắn lại cũng không thành
Short, phải xoá rồi đăng lại.

Nên hệ thống chặn ở ba lớp:

| Lớp | Làm gì |
|---|---|
| Lúc viết kịch bản | kẹp độ dài yêu cầu về tối đa **52 giây** — vì kịch bản được phép dài hơn ngân sách 15%, mà 60 + 15% là 69 |
| Lúc dựng xong | **cảnh báo** nếu file vượt 60 giây, nhưng vẫn dựng (video vẫn dùng được, và lượt gọi Claude đã tiêu rồi) |
| Lúc tải lên | **từ chối**, trước khi chiếm slot lịch. Muốn đăng như video thường thì thêm `--allow-long` |

Video khung ngang được miễn cả ba lớp.

### Tải thẳng lên YouTube

**Phải biết trước:** Google **ép mọi video upload qua API về chế độ riêng tư**
nếu project chưa qua kiểm duyệt của họ (mọi project tạo sau 28/07/2020). Nút này
lo phần chán nhất — đẩy file và dán tiêu đề, mô tả, tags — còn bạn vào YouTube
Studio bật công khai.

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
3. **OAuth consent screen** → thêm chính email của bạn vào **Test users**
4. Dán `YOUTUBE_CLIENT_ID` và `YOUTUBE_CLIENT_SECRET` vào `.env`
5. Chạy một lần, trình duyệt sẽ mở ra để bấm đồng ý:

```bash
npx tsx src/cli/index.ts youtube-auth
```

**Tiền tố tiêu đề** mặc định để trống (`YOUTUBE_TITLE_PREFIX=`). Khung tiêu đề
của Short chỉ hiện hai dòng chật chội, nên mỗi ký tự dành cho tiền tố là một ký
tự lấy mất của câu hook. Nếu vẫn muốn có:

```
YOUTUBE_TITLE_PREFIX=[Fact]
```

Khoảng trắng ngăn cách được thêm tự động (không cần đặt trong nháy). Nếu tiêu đề
cộng tiền tố vượt 100 ký tự thì phần tiêu đề bị cắt ở ranh giới từ, tiền tố luôn
được giữ.

Đổi tiền tố xong, cập nhật lại các video **đã dựng** mà không phải render lại:

```bash
npx tsx src/cli/index.ts publish-kit <id>
```

Dự án nào đã tải lên YouTube sẽ có **nhãn đỏ ▶ YouTube** ở góc thẻ ngoài màn hình
chính, bấm vào là mở thẳng video.

### Đăng theo lịch

Đây là cách dùng chính của tool. Dựng sẵn một mẻ, rồi:

```bash
npx tsx src/cli/index.ts youtube-upload-all
```

Lệnh này tải lên **mọi video đã dựng xong mà chưa từng lên kênh**, cũ trước mới
sau, **từng cái một**, mỗi cái hẹn giờ công khai cách cái trước
`SCHEDULE_INTERVAL_HOURS` (mặc định **2 giờ**). Video dựng bằng `--mock-tts` bị
bỏ qua tự động.

Vài cờ hữu ích:

```bash
npx tsx src/cli/index.ts youtube-upload-all --limit 5      # chỉ 5 cái
npx tsx src/cli/index.ts youtube-upload-all --no-schedule  # đăng luôn, không hẹn giờ
```

**"Lên lịch" là lựa chọn đứng đầu và được chọn sẵn** cho dự án mới, ở cả hai chỗ
dưới đây — đó là việc tool sinh ra để làm. Muốn dựng thử mà không đăng thì đổi
sang "Không đăng" trước khi bấm tạo video.

Hai chỗ lên lịch trong giao diện, cho hai tình huống khác nhau:

- **Video đã dựng xong rồi** → mục *Đăng lên YouTube*, ô **Chế độ** chọn
  *"Lên lịch…"* rồi bấm **Tải lên YouTube**.
- **Video sắp dựng** → mục *Video*, chọn trước rồi bấm *Tạo video*; dựng xong nó
  tự tải lên theo lựa chọn đó.

Cả ba chỗ dùng **chung một hàng đợi**, cái nào tải lên trước thì lấy slot trước.

**Bấm tải lên nhiều cái cùng lúc thì sao?** Cứ bấm thoải mái — server **tải lên
lần lượt**, không chạy song song. Cả chục video đẩy cùng lúc là
vài trăm MB tranh nhau một đường lên: tất cả cùng chậm, và cái nào hỏng giữa
chừng là mất trắng phần đã gửi. Xếp hàng thì tổng thời gian y hệt, nhưng cái đầu
tiên xong sau vài chục giây.

Hàng đợi hoạt động như sau: hệ thống giữ một mốc `a`. Video đầu tiên lên lịch sẽ
đăng vào **a + 2 giờ**, rồi `a` nhảy tới đúng giờ đó. Video sau lấy tiếp a + 2
giờ. Xếp 10 cái trong một buổi chiều thì chúng lần lượt lên sóng cách nhau hai
tiếng.

Nếu `a` đã trôi vào quá khứ (mấy hôm không đăng gì) thì nó **được kéo về hiện
tại** trước khi cộng — chứ không phải xả một loạt video ngay lập tức. Gập máy hai ngày là đã "nợ" hai tư slot.

Xem và chỉnh mốc:

```bash
npx tsx src/cli/index.ts schedule                    # xem cái tới sẽ đăng lúc nào
npx tsx src/cli/index.ts schedule --reset now        # kéo mốc về hiện tại
npx tsx src/cli/index.ts schedule --reset 2026-09-01T08:00:00
```

Khoảng cách đổi trong `.env`: `SCHEDULE_INTERVAL_HOURS=2`, tức 12 video/ngày.
Với Shorts thì mức này hoàn toàn bình thường — đây là định dạng ăn số lượng, và feed đối xử với nó
khác hẳn video dài. Nhưng nếu kênh **đăng cả video dài**, hãy tăng con số này
lên: suất đề xuất mỗi ngày của kênh là dùng chung.

Slot tính từ **lúc xếp hàng**, nên nếu bấm lúc 3 giờ sáng thì các slot cũng rơi
vào giờ xấu. Kéo mốc về giờ đẹp trước khi xếp một đợt.

**Lưu ý quan trọng:** YouTube chỉ nhận `publishAt` khi video ở chế độ private —
điều này khớp sẵn với việc project chưa audit bị ép private. Nhưng **trước khi
audit xong, lịch có thể không tự bật công khai đúng giờ**. Video vẫn lên kênh
kèm giờ hẹn ghi trong Studio; kiểm lại ở đó.

Tải lên từng cái bằng dòng lệnh:

```bash
npx tsx src/cli/index.ts youtube-upload <id> --privacy unlisted
npx tsx src/cli/index.ts youtube-upload <id> --schedule      # lấy slot kế tiếp
```

**Hệ thống biết đẩy lên kênh nào?** Qua bước cấp quyền: Google hiện màn hình
chọn tài khoản, và nếu tài khoản đó có nhiều kênh (Brand Account) thì hiện luôn
màn hình chọn kênh. Token gắn với kênh bạn chọn ở đó — lệnh upload **không** có
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
  lại `youtube-auth`. Chuyển sang *Published* thì không bị. Từ ngày thứ 5 trở đi,
  `youtube-channel` và mọi lệnh tải lên sẽ **cảnh báo trước** để bạn kịp cấp
  quyền lại, thay vì để cả ngày video không lên rồi mới phát hiện.

  Muốn *Publish* app thì Google bắt phải có **trang chủ và trang chính sách
  quyền riêng tư công khai bằng HTTPS** — `localhost` không được, vì Google tự
  đi tải hai trang đó về để kiểm tra. Hai trang mẫu đã viết sẵn trong thư mục
  `docs/`, chỉ việc đưa lên một chỗ host tĩnh miễn phí rồi dán URL vào trang
  Branding. (Ô redirect URI thì `http://localhost:4180` vẫn hợp lệ bình thường —
  đó là chuyện khác.)
- **Thumbnail chỉ đặt được nếu kênh đã xác minh số điện thoại.** Không có thì
  video vẫn lên bình thường, chỉ báo một dòng cảnh báo. Với Short thì ảnh bìa
  cũng ít quan trọng — feed phát thẳng video.
- Quota upload mặc định khoảng 100 video/ngày, nên 12 video/ngày không chạm trần.
- Token nằm ở `runtime/youtube-token.json`, đã gitignore. Muốn thu hồi thì xoá
  file đó và gỡ quyền ở [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

---

## Khung dọc hay khung ngang

```bash
VIDEO_ASPECT=portrait    # 1080x1920 — mặc định, bắt buộc nếu muốn là Short
VIDEO_ASPECT=landscape   # 1920x1080 — cho video thường
```

Bố cục tự thích ứng: cỡ chữ, lề an toàn và cách ghép ảnh đều tính từ khung hình
thật. Đổi giá trị này rồi chạy `generate <id> --force` là dựng lại video cũ theo
khung mới — **không cần** tạo lại kịch bản.

---

## `info.json` — chỉ cần khi video nói về sản phẩm

Gần như mọi video fact **không cần file này**, và đó là trường hợp bình thường.
Bộ chặn trong `src/ai/fact-guard.ts` **không kiểm tra một sự thật có đúng
không** — không đoạn code nào làm được việc đó. Nó chỉ chặn những tuyên bố
**thương mại** bịa ra: giá, bảo hành, khuyến mãi, "được chứng nhận".

Chỉ tạo file này khi video nói về một sản phẩm có số liệu cụ thể mà bạn muốn
khoá lại:

```json
{
  "name": "Baseus Bowie MA10",
  "category": "Tai nghe không dây",
  "price": 399000,
  "currency": "VND",
  "features": ["Chống ồn chủ động", "Bluetooth 5.3"]
}
```

Có file này thì **những gì không ghi trong đó, Claude không được nói** — chặn
bằng code chứ không phải bằng lời nhắc. Không có file này thì bộ chặn nghỉ, vì
một video fact có quyền nói "khoảng ba nghìn năm".

---

## Sửa video mà không tốn lượt gọi Claude

`storyboard.json` nằm trong `runtime/jobs/<id>/`. Sửa trực tiếp rồi:

```bash
npm run render -- mat-ong
```

Lệnh này **không gọi Claude, không gọi TTS** — chỉ dựng lại video. Dùng khi muốn
đổi ảnh nền, chuyển động, style, thứ tự cảnh hay chữ tiêu đề.

Nếu sửa cả `narration` (lời đọc) thì dùng `npm run generate -- mat-ong --force`;
TTS chạy lại cho phần text mới, phần cũ lấy từ cache.

Muốn Claude viết lại từ đầu:

```bash
npm run regenerate -- mat-ong
```

Mỗi lần tạo lại, bản cũ được lưu vào `storyboard-versions/` và giao diện cho
phép quay về bản trước — nên tạo lại không bao giờ mất bản đang có.

---

## Các giá trị được phép trong `storyboard.json`

Claude chỉ được chọn trong danh sách này, bạn sửa tay cũng vậy:

| Trường | Giá trị |
|---|---|
| `type` | `intro` `segment` `outro` — cảnh đầu phải `intro`, cảnh cuối phải `outro` |
| `imageQuery` | một trong các từ khoá ở `content.imageQueries` |
| `title` | chữ hiện trên màn hình, tối đa 40 ký tự; **để `""` cho hầu hết các cảnh** |
| `narration` | đoạn được đọc, tối đa 260 ký tự (~12 giây) |
| `content.imageQueries` | 2-4 từ khoá tìm ảnh, **tiếng Anh không dấu**, mỗi từ khoá 2-4 từ |
| `animation` | `none` `drift` `zoom-in` `zoom-out` `pan-left` `pan-right` `pan-up` `pan-down` |
| `transition` | `fade` `cut` — ở độ dài này `cut` là mặc định |
| `effect` | `none` `vignette` |
| `overlay` | `none` `dust` `bokeh` `rain` `light-sweep` — lớp hạt chuyển động phủ lên ảnh |
| `video.style` | `calm` (ban ngày) · `warm` (vàng ấm, lịch sử) · `night` (tối, lạnh) |
| `voice.voice` | `vi-VN-NamMinhNeural` hoặc `vi-VN-HoaiMyNeural` |

Từ khoá tìm ảnh **phải viết bằng tiếng Anh không dấu, hai đến bốn từ, và tả
thứ nhìn thấy được**. `"jellyfish underwater"` tìm ra hàng trăm ảnh;
`"Turritopsis dohrnii"` hay `"sự bất tử"` thì gần như không ra ảnh nào — kho ảnh
đánh chỉ mục theo vật thể trong ảnh, không theo khái niệm.

Bộ từ vựng cố tình ngắn: **không có rung máy, loé sáng hay chữ bay vào**. Video
đã cắt cảnh bốn năm giây một lần rồi; chồng thêm hiệu ứng giật là không ai đọc
kịp phụ đề nữa — mà với Short thì phụ đề chính là nội dung, vì rất nhiều người
xem trong trạng thái tắt tiếng.

`duration` chỉ là ước lượng — độ dài thật luôn tính từ giọng đọc, nên sửa nó
không có tác dụng.

---

## Lệnh đầy đủ

```bash
npx tsx src/cli/index.ts stock-search "<từ khoá tiếng Anh>"
npm run prepare:project -- <folder-có-info.json/brief.json>
npx tsx src/cli/index.ts suggest-brief       <id>
npx tsx src/cli/index.ts generate-storyboard <id>   # chỉ kịch bản
npm run generate        -- <id> [--force] [--mock-tts] [--voice <tên-giọng>]
npm run render          -- <id>          # 0 Claude, 0 TTS
npm run regenerate      -- <id>          # gọi lại Claude
npm run generate-all                     # tất cả project trong runtime/jobs
npx tsx src/cli/index.ts list            # project nào xong, project nào chưa
npx tsx src/cli/index.ts publish <id>    # copy thủ công sang 03_OUTPUT
npm run check           -- <file.mp4>    # kiểm tra một file output
npm run tts:sample                       # nghe thử các giọng
npm run tts:pace                         # đo lại nhịp đọc
npm run upload-all                       # đăng tất cả theo lịch
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
  "projectId": "mat-ong",
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
| `MINIMUM_IMAGES_NOT_MET` | không tìm được ảnh nào dùng được cho một cảnh | đổi `imageQuery` sang từ khoá tiếng Anh cụ thể hơn; thử trước bằng `stock-search` |
| `AI_FACT_VIOLATION` | Claude không viết được bản đạt yêu cầu sau 3 lượt — thường là **kịch bản dài quá hoặc ngắn quá** so với độ dài đã đặt | đổi "độ dài mong muốn" về 45 giây, hoặc viết chủ đề cụ thể hơn |
| `INVALID_STORYBOARD` | `storyboard.json` không đúng schema | nếu là dự án cũ từ thời tool còn làm podcast thì phải tạo lại kịch bản |
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

Thả file `.mp3` vào `assets/music/` là video sau có nhạc; dọn sạch thư mục là
hết nhạc. Nhạc **tự động nhỏ xuống khi có giọng đọc** và to lại ở quãng nghỉ —
không phải chỉnh gì.

```
MUSIC_FILE=            # để trống = lấy file đầu tiên theo thứ tự chữ cái
MUSIC_VOLUME=0.22      # mức ở quãng nghỉ; lúc đang đọc còn thấp hơn nhiều
```

Short thường được xem bằng loa điện thoại, nên nền nhạc phải nằm hẳn dưới giọng
đọc, nếu không nó ăn mất phụ âm.

Sẵn có hai bài **CC BY 3.0** (dùng thương mại được, **phải ghi tên tác giả**
trong phần mô tả video) — xem `assets/music/CREDITS.md`. Dòng ghi nguồn được
sinh tự động vào phần mô tả, đừng xoá.

Muốn dùng nhạc **YouTube Audio Library** (không cần ghi nguồn) thì tự tải về rồi
copy vào thư mục đó: kho của họ chỉ cho tải khi đã đăng nhập YouTube.
