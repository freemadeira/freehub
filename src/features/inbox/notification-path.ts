/** Where a notification leads. No browser APIs here: the notifier links there too. */
import { pagePath } from "@/features/docs/docs-context";
import { fileHref } from "@/features/drive/drive-context";
import type { NotificationTarget } from "@/lib/notification-targets";
import { cardPath, recordPath } from "@/lib/paths";

export function notificationPath(target: NotificationTarget): string {
  if ("page" in target) {
    return pagePath(target.project, target.page);
  }
  if ("file" in target) {
    return fileHref(target.project, target.file);
  }
  if ("record" in target) {
    return recordPath(target.project, target.table, target.record);
  }
  // A notification knows neither the board's other cards nor other boards
  // with its code, so it never relies on the number or the code alone.
  return cardPath(target.board, target.card, {
    query: new URLSearchParams({ board: target.board.id }),
    withId: true,
  });
}
