# Dilin Studio 1.3.33

免登入的五個編輯器——文件、表格、簡報、剪輯、畫板——整個在你自己的瀏覽器裡跑。跟 https://dilinai.com/studio 是同一份程式碼：版本號一樣就完全一樣（來源提交 `c97c2f6a7`，`src/studio/` 底下每個檔都跟網站那一版逐字相同）。

Five editors (docs, sheets, slides, video, paint) that run entirely in your browser — the same code as the editors on https://dilinai.com. AI agents: read [AGENTS.md](AGENTS.md).

## 給 AI 的說明（AI agents: read this first）

有人把這個倉的網址交給你、想請你幫他「做東西」（`docs` 文件、`sheets` 表格、`slides` 簡報、`video` 剪輯、`paint` 畫板）時，有三條路，**先問他要哪一條**：

1. **在他自己的電腦跑（單機版）**：下載編好的版本或拉下這個倉、點兩下啟動檔（見下方「下載編好的版本」與「打開」），工程只存在他的瀏覽器或他選的本機資料夾，資料留在他的電腦，不會傳到任何伺服器。你可以照格式做好 `project.json`＋`assets/` 交給他匯入，或用本機 MCP（`http://localhost:41730/mcp`）直接改他開著的編輯器。
2. **開 https://dilinai.com/studio 的網頁、在他的瀏覽器裡做**：不用安裝。編輯器在他的瀏覽器裡跑，工程存在瀏覽器本機儲存（OPFS），**不上傳**。
   - 你能直接操作他開著的頁面（例如瀏覽器擴充）：素材用頁面上的「匯入」遞進去，再改工程；能用的入口見 [AGENTS.md](AGENTS.md) 的「正式介面」。
   - 你只能產網址：給他一個帶著工程的網址 `https://dilinai.com/studio/<編輯器>#p=<資料>`（project.json 經 deflate-raw 壓縮再轉 base64url）；`#` 後面的部分不會送到伺服器。大的或帶素材的，zip 放公開 https 網址、回 `https://dilinai.com/studio/<編輯器>?import=<網址>`。
3. **拿一個短網址（`https://dilinai.com/s/<code>`）**：點開就能看、能再改，但這會把工程與素材**上傳到 https://dilinai.com 的伺服器**（暫存，關掉編輯頁就刪除）。⛔ 沒先跟他講明這一點、他也同意之前，不要呼叫 `/api/studio-share` 的接口。

他同意走第 3 條時：

- 建立：`POST https://dilinai.com/api/studio-share`，body＝`{"app":"<編輯器>","by":"ai","project":<整份 project.json>}`，回 `{"code","url","token","version"}`。`token` 是你這份的 AI 編輯憑證：**存下來**，之後每次寫入都帶它。素材走 `assets/init` → 各 part 直傳 → `assets/complete`。交給他 `https://dilinai.com/s/<code>`；之後帶憑證 `PUT .../project`（`{"base_version","project"}`），他開著的那頁會跟著更新。
- 他給你的是 `https://dilinai.com/s/<code>`：`GET https://dilinai.com/api/studio-share/<code>` 讀。要改時，手上有這份的憑證就直接 `PUT`（帶 `base_version`，409 先 GET 再改）；配對一次長期有效，只有憑證弄丟了才重新配對：你自己發 `POST .../pair-request`，請他把頁面上跳出的 6 位驗證碼告訴你，再 `pair-confirm` 拿憑證。
- 你只能讀網址、發不了請求：別叫他等驗證碼（沒發 `pair-request` 頁面不會出碼），改給他第 2 條的 `#p=` 網址。
- 短網址的作品是暫存：他關掉編輯頁就會刪除，請提醒他重要的按左邊「下載到電腦」留一份。
- 每支接口的確切欄位見 [AGENTS.md](AGENTS.md)。

本機版不用登入、不連 https://dilinai.com 帳號；想把資料留在自己電腦、要本機 MCP、或想研究改原始碼，就用本機版。

## 下載編好的版本

不想用 git、也不想裝 Node：到這個倉的 GitHub **Releases** 頁面，下載 `dilin-studio-<版本>.zip`，解壓縮到任一資料夾，再點兩下裡面的啟動檔（見下方「打開」）：

- Windows：`start-windows.bat`
- macOS：`start-mac.command`（第一次若被擋，按右鍵 →「打開」）
- Linux：`start-linux`（ARM 電腦用 `start-linux-arm64`；也可以在終端機跑 `sh start-linux.sh`）

包裡已經有編好的 `app/`，不用裝 Node（沒有 Node 時啟動檔會改用系統自帶的 PowerShell、Perl 或 Python）。zip 的 sha256 校驗碼寫在該版的 Release 說明裡，下載後可以先比對。

## 打開

點兩下這個資料夾裡的啟動檔，它會在本機開一個小服務、用瀏覽器打開 **http://localhost:41730**：

| 電腦 | 點這個 | 需要 |
|---|---|---|
| Windows | `start-windows.bat` | 不用另外裝（有 Node 用 Node，沒有就用 Windows 自帶的 PowerShell） |
| Mac | `start-mac.command` | 不用另外裝（有 Node 用 Node，沒有就用 Mac 自帶的 Perl）；第一次若被擋，按右鍵 →「打開」 |
| Linux | `start-linux`（ARM 電腦點 `start-linux-arm64`；也可以在終端機跑 `sh start-linux.sh`） | Node、Python 3 或 Perl 其中一樣 |

要停：關掉跳出來的那個黑色視窗。

直接點開 `app/index.html` 不行：瀏覽器不給「file://」開的網頁存工程的地方，畫面會請你改用啟動檔。

## 工程存在哪

- 預設存在**這個瀏覽器**裡（記在 http://localhost:41730 底下；換瀏覽器或換埠就看不到）。
- 在編輯頁左邊的工程清單按「改存到資料夾」，就改存到你電腦上的一個資料夾（`project.json`＋`assets/`），你自己的 AI 可以直接讀改；Chrome、Edge 才有這個功能。
- 隨時可以「匯出工程檔」存成一個 zip，帶到別台電腦或網站上「匯入」。
- 外面直接改了 `project.json`（例如你的 AI 改了資料夾裡那份）：剪輯頁沒有未存的改動時，約 2 秒內就在原頁換上新的內容（不會整頁重新載入）並提示一句，這一步按復原可以退回；新的 `project.json` 讀不進來（例如格式寫壞了）時，畫面保留原來那份並說明原因，改好再存一次就會換上；有未存的改動會先問你要用哪一份。
- 剪輯用的 `.m4a` 音訊要是 AAC 編碼（`ffmpeg -i in.wav -c:a aac out.m4a`）；瀏覽器解不開 ALAC，請轉檔或改用 mp3／wav。

## 交給 AI

編輯頁右邊「交給你的 AI」那一格按「複製」，把這頁網址貼給你的 AI：網頁裡帶著給 AI 看的說明，它會照著幫你做好工程、回你一個網址（點開就能看、能手動改），也會教你怎麼用。把這個倉的網址給它也行，它會照 [AGENTS.md](AGENTS.md) 做。（本機版沒有伺服器，「複製」給的是這頁網址；網站上的「複製」會給短網址 `https://dilinai.com/s/<碼>`。）

能直接操作瀏覽器頁面的 AI（例如瀏覽器擴充）可以用哪些入口讀寫工程、哪些是內部細節不要依賴，見 [AGENTS.md](AGENTS.md) 的「正式介面」一節。

### 讓 AI 直接操作開著的編輯器（MCP·畫板、剪輯、文件、表格、簡報）

用 Node 開的小服務（電腦上有裝 Node 時，三個啟動檔都會用它；或自己跑 `node tools/serve.mjs`）同時開一個本機 MCP：`http://localhost:41730/mcp`。AI 接上後，可以在你開著的畫板或剪輯頁上一條一條下命令：畫面上立刻看得到、能按 Ctrl+Z 復原、照常自動存回工程。命令名或參數寫錯，會當場擋下並說原因，不會執行。

- 支援 HTTP 連線的 AI 工具：MCP 位址填 `http://localhost:41730/mcp`。Claude Code 在終端跑這行，再重開 Claude Code（別的 AI 工具照它的寫法加同一個位址）：

  ```
  claude mcp add --transport http dilin-studio http://localhost:41730/mcp
  ```

  要 auto 模式也不停下來問，在 Claude Code 的 `settings.json` 的 `permissions.allow` 加 `"mcp__dilin-studio"`。
- 只支援 stdio 的 AI 工具：命令填 `node`，參數填這個倉的 `tools/mcp-stdio.mjs` 的完整路徑。

要先開著那個編輯器的頁面；只聽這台電腦，別台連不進來。配音、網頁截圖、音效、加素材檔要在網站上做，這裡做不了。

文件、表格、簡報也接上了：`docs_read`／`docs_edit`（讀 markdown、一段一段改）、`sheets_read`／`sheets_run`（跟網站 update_cells 同一套操作：寫值、公式、格式、插刪列欄、合併、排序、凍結、篩選、下拉）、`slides_read`／`slides_run`（跟網站簡報元件工具同一套：改字、移框、加刪元件、加頁、換版式）。每次改完頁面就存檔、重畫，看得到每一步；這三種是整頁重新載入，Ctrl+Z 退不回 AI 那一步。

畫板另有 `paint_export`：拿出分層 PSD（Photoshop 打得開每一層）、分層 Illustrator 檔（`.ai`，形狀是真路徑、文字能改）、大型文件 PSB（`.psb`，跟 PSD 同一套分層）、分層 OpenRaster（`.ora`，Krita、GIMP、MyPaint 打得開；文字和形狀照畫面存成像素）、整張 PNG 或工程檔；工程存在資料夾時，這些檔也會存進那個資料夾。

### 剪輯命令列版（不開瀏覽器）

`node tools/video-cli.mjs` 直接對工程資料夾（project.json＋assets/）做事，跟剪輯頁同一套程式：

- `check <工程>`：讀檔報告，剪輯頁開檔時會丟掉或改掉的每一條都列出來（轉場、特效寫錯、比例認不得……），有問題退出碼 1。
- `run <工程> --steps steps.json`（或 `--step '{"command":"text.add","params":{…}}'`；Windows PowerShell 請用 `--steps` 檔）：照步驟跑剪輯命令（同 MCP 的 `video_run`），全有或全無，成了寫回 project.json。
- `commands [--filter 字]`：列命令與參數規格。
- `export <工程> --format fcpxml|premiere|jianying|capcut|edl|otio|srt|vtt|ass [--out 資料夾]`：匯出 Final Cut／達芬奇的 FCPXML、Premiere 的 XML（檔案 › 匯入）、剪映或 CapCut 國際版草稿、EDL（CMX3600，只帶主軌與音訊軌）、OpenTimelineIO（.otio），或文字軌上的字幕（SRT／VTT／ASS）。
  帶到達芬奇：EDL 的配樂（只有聲音的段）達芬奇會略過，要連配樂一起帶請用 `otio` 或 `fcpxml`；達芬奇不收 ASS 字幕，請用 `srt`。
- `subs <工程> --file 字幕檔`：把 SRT／VTT／ASS 字幕一句一段排上一條文字軌（同剪輯頁「匯入本機字幕」）。
- `import <別家工程> [--out 新工程資料夾] [--media 素材資料夾]`：把 Final Cut／達芬奇的 `.fcpxml`（或 `.fcpxmld`）、Premiere 的 `.xml`、EDL（`.edl`）、OpenTimelineIO（`.otio`）、剪映／CapCut 草稿（`draft_content.json` 或草稿資料夾，沒加密的）轉成剪輯工程：素材照原路徑找，找不到再按檔名到 `--media`、工程檔旁邊、`assets/` 找，拷進新工程。片段位置、入出點、變速、音量、文字都帶過來；轉場、特效這類帶不過來的會列出來。剪輯頁也一樣：把工程檔跟素材一起選進或拖進素材區就會匯入。

要先 `npm run build`（會多打一支 `app/video-cli-core.mjs`）。配音、網頁截圖、音效、加素材檔要在網站上做。

### 不開畫面跑畫板（命令列版）

`tools/paint-cli.mjs` 用這台電腦的 Chrome、Edge 或 Chromium 在背景開一頁畫板（看不到視窗），跑的是同一套引擎和命令：

```
node tools/paint-cli.mjs run --project 我的工程 --steps steps.json --out 成品.psd
node tools/paint-cli.mjs run --step '{"command":"layer.newText","params":{"text":"Hi","size":80,"color":"#d22"}}' --out hi.png
node tools/paint-cli.mjs commands --filter text
node tools/paint-cli.mjs serve
```

Windows 的 PowerShell 會吃掉 `--step` 裡 JSON 的引號，建議把步驟寫進一個 `steps.json` 再用 `--steps steps.json`（cmd、macOS、Linux 照上面寫都行）。

- `--project`：工程資料夾（`project.json`＋`assets/`）或單一 `project.json`；不給就是一張白底新畫布。
- `--open`：照分層打開一份 `.psd`／`.psb`、`.svg`、`.pdf`、Illustrator `.ai`（要存了「PDF 相容」的那種）、Krita `.kra`、OpenRaster `.ora`、GIMP `.xcf` 或 Procreate `.procreate`，再跑步驟、輸出。畫板的「檔案 › 開啟」也一樣分層開。
- `--steps`：一個 JSON 陣列，每項 `{"command": …, "params": {…}}`；遇到第一個錯就停，退出碼 1。座標都是文件像素、原點在左上角；例如正多邊形 `shape.polygon {"cx","cy","r1","points"}`（`r1` 外接圓半徑，也可寫 `radius`；`points` 邊數 3～1000，也可寫 `sides`，預設 6），星形 `shape.star {"cx","cy","r1","r2","points"}`（`r1` 外半徑，也可寫 `radius` 或 `radius1`；`r2` 內半徑，也可寫 `radius2`，可省，預設外半徑的一半；`points` 角數 2～1000，預設 5）。缺了中心或半徑、或邊數／角數不合，命令會回錯並說明該給哪個參數。
- `--out`：`.psd`（分層）、`.psb`（分層大型文件）、`.ai`（分層 Illustrator）、`.ora`（分層 OpenRaster）、`.png`，或一個資料夾（存 `project.json`＋`assets/`）。
- `serve`：不開畫面，只把 MCP 開在 `http://localhost:41731/mcp` 給 AI 用，按 Ctrl+C 停。
- 找不到瀏覽器時用 `--chrome <執行檔>` 指定。

## 網路連線說明

單機版不用登入，也不連堤麟網站的服務：工程存在你的瀏覽器或你選的資料夾，不會上傳。只有用到下面這幾樣時，瀏覽器才會向外取檔；取過一次之後多半走瀏覽器快取：

- 字型：用到網路字型時（字型清單裡的網路字型、簡報主題自帶的字型），從 Google Fonts（`fonts.googleapis.com`、`fonts.gstatic.com`）或 jsDelivr（`cdn.jsdelivr.net`：霞鶩文楷、得意黑）載入。
- 簡報：部分皮膚的裝飾圖從堤麟的公開圖床 `img.dilinai.com` 讀取（只讀圖，不帶工程內容）。導出的網頁版簡報會引用 Google Fonts，打開它的瀏覽器也會去連。
- 網頁裡識別字幕、拆曲（分軌）：單機版沒有設定模型下載站，這兩項預設不開放。自己重新打包時在 `tools/build.mjs` 第一段 `define` 加一行 `'process.env.NEXT_PUBLIC_VEDIT_ASR_MODEL_HOST': '"https://huggingface.co/"'`（或你的鏡像）才會打開。打開後第一次用會從那個站下載模型（識別字幕：`onnx-community/whisper-large-v3-turbo`，約 760 MB；拆曲：`seanghay/uvr_models` 的 `UVR-MDX-NET-Inst_HQ_3.onnx`，約 67 MB），程式庫 transformers.js、onnxruntime-web 與字幕繁簡轉換用的 opencc-js 從 `cdn.jsdelivr.net` 取（設了鏡像就改從 `<鏡像>/npm/` 取），之後走瀏覽器快取。聲音在你的電腦上識別，不會上傳。
- 你自己給的匯入網址（`?import=<網址>`）：瀏覽器會去取那個網址。
- 頁面上的連結（GitHub、堤麟網站等）只在你點了才會打開。

## 自己重新打包（開發者）

```
npm install
npm run build    # 產出 app/
npm start        # 等於 node tools/serve.mjs
```

各編輯器用到的第三方套件與授權寫在 `src/studio/**/THIRD_PARTY.md`。

### 啟動器建置

倉根的 `start-linux`（x86-64）與 `start-linux-arm64`（ARM64）是預編譯的靜態執行檔，由 `tools/launcher/start-linux.c` 編出，只做一件事：開終端機視窗跑同一資料夾的 `start-linux.sh`。重新編譯（要 `gcc` 與 `aarch64-linux-gnu-gcc`）：

```
sh tools/launcher/build.sh
# 等於：
gcc -static -Os -s -o start-linux tools/launcher/start-linux.c
aarch64-linux-gnu-gcc -static -Os -s -o start-linux-arm64 tools/launcher/start-linux.c
```

附的兩支是在 Ubuntu 24.04 用 gcc 13.3.0（套件 `gcc`、`gcc-aarch64-linux-gnu`）編的，同版本工具鏈重編逐位元組相同。sha256：

- `start-linux`：`dc650c0b539cd98667c60c33fca41c7a2841c2549d675207ca8b831d1a3b9816`
- `start-linux-arm64`：`01d66cd3a6287d74c0838a6fefc62fdea2e9322e67f64eeaf9e1887bbed31ab7`

## 授權

本專案以 [Apache License 2.0](LICENSE) 授權：誰都能用、改、商用，條款裡附專利授權。「堤麟」「Dilin」等名稱與標誌不在授權範圍內（見 [NOTICE](NOTICE)）。第三方的部分照各自的授權。

## 版本

`studio-oss.json`：版本（{"base":"1.3.33","docs":"1.3.28","sheets":"1.4.5","slides":"1.3.27","video":"1.3.34","paint":"1.3.41"}）、來源提交、每個檔的雜湊。
