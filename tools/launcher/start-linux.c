/*
 * Dilin Studio Linux 啟動器：在檔案管理器裡點兩下就開（多數 Linux 檔案管理器點兩下 .sh 只會用文字編輯器打開，點兩下程式才會執行）。
 * 它只做一件事：開一個終端機視窗跑同一資料夾的 start-linux.sh（關掉那個視窗就停）；這台沒有認得的終端機 ⇒ 直接跑 start-linux.sh（照樣開瀏覽器）。
 * 重新編譯：sh tools/launcher/build.sh（要 gcc；arm64 版要 aarch64-linux-gnu-gcc）。
 */
#include <libgen.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static char dir[PATH_MAX], script[PATH_MAX + 32];

/* execvp 成功就不回來；這台沒有這支 ⇒ 回來試下一支 */
static void try_term(char *const argv[]) { execvp(argv[0], argv); }

int main(void) {
  char self[PATH_MAX];
  ssize_t n = readlink("/proc/self/exe", self, sizeof self - 1);
  if (n <= 0) { fprintf(stderr, "找不到自己在哪個資料夾\n"); return 1; }
  self[n] = 0;
  snprintf(dir, sizeof dir, "%s", dirname(self));
  snprintf(script, sizeof script, "%s/start-linux.sh", dir);
  if (chdir(dir) != 0 || access(script, R_OK) != 0) { fprintf(stderr, "同一個資料夾裡找不到 start-linux.sh\n"); return 1; }

  if (getenv("DISPLAY") || getenv("WAYLAND_DISPLAY")) {
    { char *a[] = {"gnome-terminal", "--", "sh", script, NULL}; try_term(a); }
    { char *a[] = {"ptyxis", "--", "sh", script, NULL}; try_term(a); }
    { char *a[] = {"kgx", "-e", "sh", script, NULL}; try_term(a); }
    { char *a[] = {"konsole", "-e", "sh", script, NULL}; try_term(a); }
    { char *a[] = {"xfce4-terminal", "-x", "sh", script, NULL}; try_term(a); }
    { char *a[] = {"mate-terminal", "-x", "sh", script, NULL}; try_term(a); }
    { char *a[] = {"lxterminal", "-e", "sh", script, NULL}; try_term(a); }
    { char *a[] = {"x-terminal-emulator", "-e", "sh", script, NULL}; try_term(a); }
    { char *a[] = {"xterm", "-e", "sh", script, NULL}; try_term(a); }
  }
  /* 沒有認得的終端機（或本來就在終端機裡跑）⇒ 直接跑 */
  char *a[] = {"sh", script, NULL};
  execvp(a[0], a);
  fprintf(stderr, "沒辦法執行 sh\n");
  return 1;
}
