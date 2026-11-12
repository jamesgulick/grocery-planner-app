// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.

// Copy text to the clipboard using the path that actually works in the iOS
// webview (hidden textarea + execCommand), with the modern API as a bonus.
// Returns true on success. Used by all family-comms buttons — sms: links are
// blocked in this webview, so we copy the message for the user to paste.
function copyToClipboard(text) {
  let ok = false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    ok = document.execCommand("copy");
    document.body.removeChild(ta);
  } catch (e) { ok = false; }
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {});
  return ok;
}

export { copyToClipboard };
