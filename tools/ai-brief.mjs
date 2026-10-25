// 单页版 app/index.html 里「人看不到、AI 抓网址就读得到」的说明（build.mjs 打包时塞进去）：
//   网站版的说明是服务端渲染的（src/studio/shared/ui/AIBrief.tsx）；单页版只有静态 index.html，不塞的话 AI 抓网址只看到「Dilin Studio」几个字。
//   内容：这是本机那份、最好先接本机 MCP（Node 服务开的页才有·给现成 claude mcp add 那行与 permissions.allow）、
//   接不上才改档（请用户按「改存到资料夾」⇒ 改 project.json ⇒ 页面约 1.5 秒自动跟上）、
//   按不了时走「匯出工程檔／匯入」zip，最后附五个编辑器的 FORMAT.md 全文。
//   视觉上用 clip 藏起来（⛔ display:none／hidden：很多抓取器转文字会丢）。

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const APPS = ['video', 'docs', 'sheets', 'slides', 'paint']

const TEXT = {
  'zh-TW': {
    heading: '給 AI 的說明：這是本機的 Dilin Studio',
    paras: [
      '使用者把這個網址交給你，是要你幫他剪輯或編輯。這頁是 Dilin Studio 的本機單機版（只在他這台電腦跑、不連網站、不用登入），網址裡的 ?app= 是哪個編輯器：video 剪輯、docs 文件、sheets 表格、slides 簡報、paint 畫板；&id= 是這份工程的編號。',
      '最好的做法：接本機 MCP（不用問使用者資料夾路徑、不用選位置）。這頁是用 Node 開的（網址是 http://localhost:41730/ 這種）時，同一個位址加 /mcp 就是本機 MCP；先 GET 一下 http://localhost:41730/mcp，回得來就用這條。',
      '接法：請使用者在終端自己跑一行（Claude Code 為例）：claude mcp add --transport http dilin-studio http://localhost:41730/mcp，然後重開 Claude Code。要 auto 模式也不停下來問，請使用者在 Claude Code 的 settings.json 的 permissions.allow 加 "mcp__dilin-studio"。只吃 stdio 的 AI：命令 node、參數是這個資料夾 tools/mcp-stdio.mjs 的完整路徑。別自己替使用者改 AI 的設定檔。',
      '接上之後：先叫 studio_pages 看開著哪幾頁，再用對應編輯器的工具一步一步改——畫板 paint_list_commands／paint_run、剪輯 video_list_commands／video_run、文件 docs_read／docs_edit、表格 sheets_read／sheets_run、簡報 slides_read／slides_run。每次改一兩處，畫面當場跟著變、照常自動存回工程。',
      '/mcp 不通（例如是 PowerShell 或別的簡單網頁服務開的頁，或使用者的 AI 接不了 MCP）才用下面改檔那條。',
      '直接改、畫面即時跟著變的做法（Claude Code、Codex 這類在使用者電腦上跑的 AI 用這條）：',
      '0. 你的第一句話就請使用者照第 1 步選位置。不要自己先在別處建 project.json、不要去下載或翻 app.js 的程式碼，下面的說明和格式就夠了。',
      '1. 這頁一打開會要求使用者先選工程檔存放位置，選好前什麼都不能做。他還沒選的話，請他在這頁右邊「交給你的 AI」那塊按「選擇工程檔存放位置」，挑或新建一個資料夾（例如放素材的那個資料夾底下新建一個），瀏覽器問能不能修改檔案時按允許。這一下只能人按，你按不了。這要電腦版 Chrome 或 Edge；其他瀏覽器（Safari、Firefox、手機、鴻蒙）用不了單機版，請他換用 Chrome 或 Edge。',
      '2. 請使用者告訴你挑了哪個資料夾。那個資料夾裡就是這份工程：project.json（整份工程）和 assets/（素材原檔，project.json 用檔名指到它們）。',
      '3. 要用的影片、圖片、聲音，先拷進 assets/，再照下面的格式說明改 project.json。保留開頭的 "format" 和 "version"，不要動到你沒要改的欄位。',
      '4. 存檔後，開著的編輯頁大約 1.5 秒內會自己重新載入，使用者馬上看到變化，不用重新整理。使用者如果有沒存的改動，頁面會先問他要不要重新載入。',
      '5. 改完跟使用者說改了什麼，請他看畫面；要再調就再改檔。',
      '先用一兩句話教使用者要按哪顆鈕，不要把這份說明整段貼給他。',
      '下面是五個編輯器的工程檔格式（英文）。動手前先讀對應編輯器那一段。',
    ],
  },
  'zh-CN': {
    heading: '给 AI 的说明：这是本机的 Dilin Studio',
    paras: [
      '用户把这个网址交给你，是要你帮他剪辑或编辑。这页是 Dilin Studio 的本机单机版（只在他这台电脑跑、不连网站、不用登录），网址里的 ?app= 是哪个编辑器：video 剪辑、docs 文档、sheets 表格、slides 演示、paint 画板；&id= 是这份工程的编号。',
      '最好的做法：接本机 MCP（不用问用户文件夹路径、不用选位置）。这页是用 Node 开的（网址是 http://localhost:41730/ 这种）时，同一个地址加 /mcp 就是本机 MCP；先 GET 一下 http://localhost:41730/mcp，回得来就用这条。',
      '接法：请用户在终端自己跑一行（以 Claude Code 为例）：claude mcp add --transport http dilin-studio http://localhost:41730/mcp，然后重开 Claude Code。要 auto 模式也不停下来问，请用户在 Claude Code 的 settings.json 的 permissions.allow 加 "mcp__dilin-studio"。只支持 stdio 的 AI：命令 node、参数是这个文件夹 tools/mcp-stdio.mjs 的完整路径。别自己替用户改 AI 的配置文件。',
      '接上之后：先调 studio_pages 看开着哪几页，再用对应编辑器的工具一步一步改——画板 paint_list_commands／paint_run、剪辑 video_list_commands／video_run、文档 docs_read／docs_edit、表格 sheets_read／sheets_run、演示 slides_read／slides_run。每次改一两处，画面当场跟着变、照常自动存回工程。',
      '/mcp 不通（例如是 PowerShell 或别的简单网页服务开的页，或用户的 AI 接不了 MCP）才用下面改文件那条。',
      '直接改、画面实时跟着变的做法（在用户电脑上跑的 AI 程序助手用这条）：',
      '0. 你的第一句话就请用户照第 1 步选位置。不要自己先在别处建 project.json、不要去下载或翻 app.js 的代码，下面的说明和格式就够了。',
      '1. 这页一打开会要求用户先选工程文件存放位置，选好前什么都不能做。他还没选的话，请他在这页右边「交给你的 AI」那块点「选择工程文件存放位置」，挑或新建一个文件夹，浏览器问能不能修改文件时点允许。这一下只能人点，你点不了。这要电脑版 Chrome 或 Edge；其他浏览器（手机、鸿蒙等）用不了单机版，请他换用 Chrome 或 Edge。',
      '2. 请用户告诉你挑了哪个文件夹。那个文件夹里就是这份工程：project.json（整份工程）和 assets/（素材原文件，project.json 用文件名指到它们）。',
      '3. 要用的视频、图片、声音，先拷进 assets/，再照下面的格式说明改 project.json。保留开头的 "format" 和 "version"，不要动你没要改的字段。',
      '4. 保存后，开着的编辑页大约 1.5 秒内会自己重新载入，用户马上看到变化，不用刷新。用户如果有没存的改动，页面会先问他要不要重新载入。',
      '5. 改完跟用户说改了什么，请他看画面；要再调就再改文件。',
      '先用一两句话教用户要点哪个按钮，不要把这份说明整段贴给他。',
      '下面是五个编辑器的工程文件格式（英文）。动手前先读对应编辑器那一段。',
    ],
  },
  en: {
    heading: 'Notes for an AI: this is a local copy of Dilin Studio',
    paras: [
      'The user gave you this address because they want you to edit something with it. This page is the local, stand-alone Dilin Studio (it runs only on their computer, no website, no sign-in). ?app= in the address names the editor: video, docs, sheets, slides or paint; &id= is this project\'s id.',
      'Best way: connect to the local MCP (no need to ask the user for a folder path or to pick a folder). When this page is served by the Node server (an address like http://localhost:41730/), the same address plus /mcp is a local MCP; try GET http://localhost:41730/mcp first and use this way if it answers.',
      'To connect: ask the user to run one line in their terminal (Claude Code shown): claude mcp add --transport http dilin-studio http://localhost:41730/mcp, then restart Claude Code. So that auto mode does not stop to ask, ask the user to add "mcp__dilin-studio" to permissions.allow in Claude Code\'s settings.json. AI tools that only speak stdio: command node, argument the full path of tools/mcp-stdio.mjs in this folder. Do not edit the user\'s AI settings yourself.',
      'Once connected: call studio_pages to see which pages are open, then change things step by step with that editor\'s tools — paint paint_list_commands / paint_run, video video_list_commands / video_run, docs docs_read / docs_edit, sheets sheets_read / sheets_run, slides slides_read / slides_run. Change one or two things per call; the page follows at once and saves back to the project as usual.',
      'Only if /mcp does not answer (the page is served by PowerShell or another simple web server, or the AI cannot use MCP) use the file-editing way below.',
      'To edit directly and have the page follow live (for AI that runs on the user\'s computer, such as Claude Code or Codex):',
      '0. In your first reply, ask the user to do step 1. Don\'t build a project.json somewhere yourself first and don\'t download or read app.js; these notes and the formats below are enough.',
      '1. This page first asks the user to choose where to save the project; nothing works until they do. If they haven\'t yet, ask them to click "Choose where to save the project" in the "Hand it to your AI" panel on the right of this page, pick or create a folder, and allow the browser to edit files there. Only a person can click this. It needs desktop Chrome or Edge; other browsers (Safari, Firefox, phones) can\'t run the stand-alone version, so ask them to switch to Chrome or Edge.',
      '2. Ask the user which folder they picked. That folder is the project: project.json (the whole project) and assets/ (original media files, referenced by file name from project.json).',
      '3. Copy any video, images or audio you need into assets/, then edit project.json following the format notes below. Keep the "format" and "version" header and leave fields you are not changing alone.',
      '4. After you save, the open editor reloads by itself within about 1.5 seconds and the user sees the change without refreshing. If they have unsaved edits, the page asks them first.',
      '5. Tell the user what you changed and ask them to look; to adjust, edit the file again.',
      'Teach the user which button to press in a sentence or two; don\'t paste these notes to them.',
      'Below are the project formats of the five editors. Read the one for this editor before writing anything.',
    ],
  },
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export { TEXT as AI_BRIEF_TEXT }

/** 单机版只有一个版本（不分陆台）⇒ 三语都出。回传要塞在 <body> 开头的那段 HTML。 */
export function aiBriefHtml(repo) {
  const langs = ['zh-TW', 'zh-CN', 'en']
  const clip = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:normal;border:0'
  const out = [`<section style="${clip}" data-testid="studio-ai-brief" data-ai-instructions="true">`]
  for (const lang of langs) {
    const t = TEXT[lang]
    out.push(`<div lang="${lang}"><h2>${esc(t.heading)}</h2>`)
    for (const p of t.paras) out.push(`<p>${esc(p)}</p>`)
    out.push('</div>')
  }
  for (const app of APPS) {
    const f = join(repo, 'src', 'studio', app, 'FORMAT.md')
    if (!existsSync(f)) continue
    out.push(`<pre data-format="${app}" style="white-space:pre-wrap">${esc(readFileSync(f, 'utf8'))}</pre>`)
  }
  out.push('</section>')
  return out.join('\n')
}
