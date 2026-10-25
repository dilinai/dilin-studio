# 安全問題回報

發現安全問題（例如能讀到別人的作品、繞過短網址的編輯憑證、本機服務被別台電腦連進來、匯入特製檔案能執行程式）時，請**不要**公開開 issue 或 PR，改用 GitHub 的私下回報：

1. 打開這個倉的頁面，點上方的 **Security**。
2. 按 **Report a vulnerability**，填寫內容後送出。

只有維護者看得到這份回報。請附上：影響的編輯器與版本（`studio-oss.json` 的 `version`）、重現步驟、可能的影響；有測試檔或截圖也一併附上。

維護者確認後會在上游修好，隨下一個版本發布，並在 Release 說明致謝（你不想具名也可以說）。修好之前請先不要公開細節。

`https://dilinai.com` 網站本身的問題也可以用同一個方式回報。

---

# Reporting security issues

If you find a security problem (for example reading someone else's work, bypassing a short link's editing credential, the local server accepting connections from other machines, or a crafted import file running code), please do **not** open a public issue or PR. Use GitHub's private vulnerability reporting instead:

1. Open this repository's page and click **Security** at the top.
2. Click **Report a vulnerability**, fill in the form and submit it.

Only the maintainers can see the report. Please include the affected editor and version (`version` in `studio-oss.json`), steps to reproduce and the possible impact; attach test files or screenshots if you have them.

Once confirmed, the fix is made upstream and ships with the next release; the release notes credit you (tell us if you prefer not to be named). Please keep the details private until the fix is released.

Problems with the `https://dilinai.com` website itself can be reported the same way.
