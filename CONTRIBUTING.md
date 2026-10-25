# 參與貢獻

歡迎開 issue 回報問題、提建議，也歡迎送 PR。

## 這個倉怎麼更新

這個倉是從上游的原始碼**機械同步**出來的：每出一個版本，整個倉就照上游那一版重新產生、整份覆蓋（`studio-oss.json` 記著來源提交與每個檔的雜湊，`src/studio/` 底下每個檔都要跟上游逐字相同）。所以：

- PR **不會在 GitHub 上直接合併**。維護者審過之後，會把改動移回上游，隨下一個版本一起發布。
- 收進去之後，會在 PR 留言註明收進哪一版，再把 PR 關閉；該版的 Release 說明會列出貢獻者。
- 署名：小改動照記原作者；改動較大、維護者另外調整過的，以 `Co-authored-by:` 共同署名；只採用了想法、程式碼沒有用上的，在 Release 說明致謝。

## 授權

不需要簽 CLA。送出的貢獻以本倉的 [Apache License 2.0](LICENSE) 授權（同條款第 5 條）。「堤麟」「Dilin」等名稱與標誌不在授權範圍內（見 [NOTICE](NOTICE)）。

## 先開 issue

較大的改動（新功能、改檔案格式、動到多個編輯器、換套件）請先開 issue 討論做法，免得做完才發現方向不合。錯字、小修正可以直接送 PR。

安全問題請**不要**公開開 issue，照 [SECURITY.md](SECURITY.md) 私下回報。

## 在本機跑

不用安裝也能用：點兩下倉根的啟動檔（Windows `start-windows.bat`、Mac `start-mac.command`、Linux `start-linux`），瀏覽器會打開 http://localhost:41730 。詳見 [README](README.md)。

改原始碼後重新打包（要 Node.js 18 以上）：

```
npm install
npm run build    # 產出 app/
npm start        # 等於 node tools/serve.mjs，打開 http://localhost:41730
```

## 測試

送 PR 前請至少：

- `npm run build` 能過。
- 用改到的編輯器實際開一份工程、存檔、重新整理後確認內容還在。
- 改到剪輯的工程檔讀寫時，跑 `node tools/video-cli.mjs check <工程資料夾>`，確認沒有被丟掉或改掉的項目。
- 改到畫板命令時，跑 `node tools/paint-cli.mjs run --steps <steps.json> --out <輸出檔>` 確認命令照預期執行。

`src/studio/**/*.test.ts` 等測試檔跟上游同一份，有些要上游倉的環境才跑得起來；維護者移回上游時會跑完整測試。

---

# Contributing

Issues and pull requests are welcome.

## How this repository is updated

This repository is **generated mechanically** from the upstream source: every release regenerates the whole repository from that upstream version and overwrites it (`studio-oss.json` records the source commit and a hash of every file; every file under `src/studio/` must stay byte-for-byte identical to upstream). Therefore:

- Pull requests are **not merged on GitHub directly**. After review, a maintainer moves the change into upstream and it ships with the next release.
- Once it is taken in, the maintainer comments on the PR with the version that includes it and then closes the PR; the release notes for that version list the contributors.
- Credit: small changes keep the original author; larger changes that the maintainer adjusted are co-authored with a `Co-authored-by:` trailer; if only the idea was used and not the code, the release notes credit you.

## License

No CLA is required. Contributions are licensed under this repository's [Apache License 2.0](LICENSE) (see section 5 of the license). The names and logos "堤麟" and "Dilin" are not covered by the license (see [NOTICE](NOTICE)).

## Open an issue first

For larger changes (new features, file format changes, changes across several editors, new dependencies) please open an issue to discuss the approach first. Typos and small fixes can go straight to a PR.

Please do **not** report security problems in public issues; follow [SECURITY.md](SECURITY.md).

## Run it locally

No install is needed to use it: double-click a start file in the repository root (Windows `start-windows.bat`, Mac `start-mac.command`, Linux `start-linux`) and the browser opens http://localhost:41730 . See the [README](README.md).

To rebuild after changing the source (Node.js 18+):

```
npm install
npm run build    # builds app/
npm start        # same as node tools/serve.mjs, serves http://localhost:41730
```

## Testing

Before sending a PR, please at least:

- Make sure `npm run build` succeeds.
- Open a project in the editor you changed, save, reload the page and check the content is still there.
- If you changed how video projects are read or written, run `node tools/video-cli.mjs check <project folder>` and check that nothing is dropped or changed.
- If you changed paint commands, run `node tools/paint-cli.mjs run --steps <steps.json> --out <output file>` and check the commands do what you expect.

Test files such as `src/studio/**/*.test.ts` are the same as upstream; some of them only run in the upstream repository's environment. The maintainer runs the full test suite when moving a change upstream.
