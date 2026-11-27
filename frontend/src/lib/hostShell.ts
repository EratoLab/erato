/**
 * A native app that shows this web app may inject `window.ERATO_SHELL` before
 * the page's scripts run. The page asks it which capabilities exist and uses
 * only those; without the object (a normal browser) nothing changes.
 */
export interface HostShell {
  capabilities: Readonly<Record<string, number>>;
  /** Rejects with `{ code, message }`. */
  request(method: string, params?: unknown): Promise<unknown>;
  /** Returns an unsubscribe function. */
  on(event: string, listener: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    // Injected by the host, unlike the ERATO_* globals this page exposes.
    ERATO_SHELL?: unknown;
  }
}

/** The shape this page reads; a host raises it only when the shape changes. */
const CONTRACT = 1;

/** Whether a native app shows this page through the shell contract. */
export function inHostShell(): boolean {
  return hostShell() !== null;
}

/** The shell, whatever it offers; for events a page hears either way. */
export function hostShell(): HostShell | null {
  if (typeof window === "undefined") return null;
  const shell = window.ERATO_SHELL;
  return isHostShell(shell) ? shell : null;
}

/** The shell, when it offers `capability` at `minVersion` or later. */
export function hostShellWithCapability(
  capability: string,
  minVersion: number,
): HostShell | null {
  if (typeof window === "undefined") return null;
  const shell = window.ERATO_SHELL;
  if (!isHostShell(shell)) return null;
  const version = shell.capabilities[capability];
  return typeof version === "number" && version >= minVersion ? shell : null;
}

function isHostShell(value: unknown): value is HostShell {
  if (typeof value !== "object" || value === null) return false;
  const shell = value as Record<string, unknown>;
  return (
    shell.contract === CONTRACT &&
    typeof shell.capabilities === "object" &&
    shell.capabilities !== null &&
    typeof shell.request === "function" &&
    typeof shell.on === "function"
  );
}

/** Where a sheet points on a wide screen: the element, in CSS pixels. */
export interface ShellAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function shellAnchor(element: Element): ShellAnchor {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}
