/** This tab's sessionStorage, or null where the browser blocks it. */
export function safeSessionStorage(win: Window = window): Storage | null {
  try {
    return win.sessionStorage;
  } catch {
    return null;
  }
}
