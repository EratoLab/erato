/**
 * Puts `text` on the clipboard, preferring the async Clipboard API and falling
 * back to a hidden textarea plus the deprecated `execCommand`.
 *
 * The fallback is the whole point: Teams and Outlook on the web serve their
 * frames with a Permissions-Policy that withholds clipboard-write, so
 * `navigator.clipboard.writeText` rejects there — which is exactly where the
 * PDF viewer has to work, since a sandboxed frame is why it exists at all.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyViaTextarea(text);
  }
}

function copyViaTextarea(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  // Off-screen rather than hidden: execCommand ignores a selection inside an
  // element that is not rendered.
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  // eslint-disable-next-line lingui/no-unlocalized-strings
  textarea.style.top = "-9999px";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  const previousSelection = document.getSelection()?.rangeCount
    ? document.getSelection()?.getRangeAt(0)
    : null;

  try {
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    if (previousSelection) {
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(previousSelection);
    }
  }
}
