// Send to Claude (calendar sync, the way out; decided 11/14). One action in two places,
// the Sync row and the Data sheet: build the normal export (its _meta carries the sync
// instructions from Settings), copy the fixed prompt, and open the share sheet with the
// file and the prompt as share text. Where the share sheet can't take a file, download
// the export instead; the prompt is on the clipboard either way.
// The prompt is generic on purpose: the instructions themselves are the user's, kept in
// Settings and the exported file, never in this public code.
import { copyToClipboard } from "./clipboard.js";
import { buildBackupPayload, downloadBackup, exportFileName } from "./exportData.js";

export const SYNC_PROMPT = "Update the calendar parts of the attached grocery planner file. Follow the sync instructions in its _meta node, change nothing else, and send back the whole file.";

/** Returns "shared" | "cancelled" | "downloaded". Call straight from a tap (share needs it). */
export async function sendToClaude(db, persistDB) {
  copyToClipboard(SYNC_PROMPT);
  const { text } = buildBackupPayload(db);
  const file = new File([text], exportFileName(), { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: SYNC_PROMPT });
      return "shared";
    } catch (e) {
      if (e?.name === "AbortError") return "cancelled";
    }
  }
  downloadBackup(db, persistDB);
  return "downloaded";
}
