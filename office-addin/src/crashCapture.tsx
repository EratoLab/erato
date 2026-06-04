/**
 * TEMPORARY crash-capture diagnostics.
 *
 * Purpose: the task pane goes fully blank on some transitions (e.g. Outlook
 * read -> compose). A blank pane is a React tree unmount caused by an
 * uncaught *render/commit-phase* throw — and since attaching DevTools to an
 * embedded Outlook WebView is awkward, we capture the stack from inside the
 * pane instead.
 *
 * What it does:
 *  - {@link RootCrashBoundary} catches render/commit errors anywhere in the
 *    tree and exposes `error.stack` AND `errorInfo.componentStack` — the
 *    component stack is what actually names the throwing render.
 *  - {@link installGlobalCrashHandlers} catches `error` / `unhandledrejection`
 *    events so async throws (Office.js callbacks, promise rejections) are
 *    recorded too. If a crash shows up ONLY here and never in the boundary,
 *    the blank has a non-render cause and we look elsewhere.
 *  - Both write to a fixed DOM overlay mounted on `document.body` — OUTSIDE
 *    the React root — so the captured text stays visible and copyable even
 *    after React unmounts the whole app.
 *
 * Everything is prefixed `[CRASH]` in the console for easy filtering.
 *
 * Run the dev build (`pnpm dev`, sourcemaps on) so frames map back to .tsx.
 * Flip {@link CRASH_CAPTURE} to `false` to silence, or delete this file and
 * its two imports in `main.tsx` to fully restore the original behaviour.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

export const CRASH_CAPTURE = true;

interface CrashEntry {
  kind: "render" | "window.error" | "unhandledrejection";
  message: string;
  stack?: string | null;
  componentStack?: string | null;
}

// Accumulated text of every crash captured this session, so the "Copy" button
// can hand back the whole log in one go.
const capturedLog: string[] = [];

function logToConsole(line: string): void {
  console.error("[CRASH]", line);
}

function formatEntry(entry: CrashEntry): string {
  const parts = [`[CRASH:${entry.kind}] ${entry.message}`];
  if (entry.stack) {
    parts.push("", "stack:", entry.stack);
  }
  if (entry.componentStack) {
    parts.push("", "componentStack:", entry.componentStack);
  }
  return parts.join("\n");
}

const OVERLAY_ID = "crash-capture-overlay";
const OVERLAY_BODY_ID = "crash-capture-overlay-body";

function ensureOverlay(): HTMLElement | null {
  if (typeof document === "undefined") return null;

  const existing = document.getElementById(OVERLAY_BODY_ID);
  if (existing) return existing;

  const container = document.createElement("div");
  container.id = OVERLAY_ID;
  container.setAttribute(
    "style",
    [
      "position:fixed",
      "inset:0 0 auto 0",
      "max-height:65vh",
      "overflow:auto",
      "z-index:2147483647",
      "background:#3a0d0d",
      "color:#ffd9d9",
      "font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace",
      "border-bottom:2px solid #ff5a5a",
      "box-shadow:0 2px 12px rgba(0,0,0,.5)",
    ].join(";"),
  );

  const header = document.createElement("div");
  header.setAttribute(
    "style",
    [
      "position:sticky",
      "top:0",
      "display:flex",
      "gap:8px",
      "align-items:center",
      "padding:6px 10px",
      "background:#5a1414",
      "border-bottom:1px solid #ff5a5a",
    ].join(";"),
  );

  const title = document.createElement("strong");
  title.textContent = "CRASH CAPTURED";
  title.setAttribute("style", "flex:1;color:#fff");

  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copy";
  copyBtn.setAttribute(
    "style",
    "cursor:pointer;padding:2px 10px;background:#fff;color:#000;border:0;border-radius:4px",
  );
  copyBtn.onclick = () => {
    const all = capturedLog.join(
      "\n\n----------------------------------------\n\n",
    );
    void navigator.clipboard?.writeText(all).then(
      () => {
        copyBtn.textContent = "Copied";
      },
      () => {
        copyBtn.textContent = "Copy failed";
      },
    );
  };

  const dismissBtn = document.createElement("button");
  dismissBtn.textContent = "Dismiss";
  dismissBtn.setAttribute(
    "style",
    "cursor:pointer;padding:2px 10px;background:transparent;color:#fff;border:1px solid #fff;border-radius:4px",
  );
  dismissBtn.onclick = () => container.remove();

  header.append(title, copyBtn, dismissBtn);

  const body = document.createElement("div");
  body.id = OVERLAY_BODY_ID;
  body.setAttribute(
    "style",
    "padding:8px 10px;white-space:pre-wrap;word-break:break-word",
  );

  container.append(header, body);
  document.body.appendChild(container);
  return body;
}

function record(entry: CrashEntry): void {
  if (!CRASH_CAPTURE) return;

  const text = formatEntry(entry);
  capturedLog.push(text);
  logToConsole(text);

  const body = ensureOverlay();
  if (!body) return;

  const block = document.createElement("pre");
  block.setAttribute(
    "style",
    "margin:0 0 12px;padding:8px;background:rgba(0,0,0,.25);border-radius:4px;white-space:pre-wrap;user-select:text",
  );
  block.textContent = text;
  body.appendChild(block);
}

let globalHandlersInstalled = false;

/**
 * Install window-level handlers for async / uncaught errors. Idempotent so
 * StrictMode double-invokes and HMR don't stack duplicate listeners.
 */
export function installGlobalCrashHandlers(): void {
  if (globalHandlersInstalled || typeof window === "undefined") return;
  globalHandlersInstalled = true;

  window.addEventListener("error", (event) => {
    const error = event.error as Error | undefined;
    record({
      kind: "window.error",
      message: error?.message ?? event.message ?? "(no message)",
      stack: error?.stack ?? null,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as unknown;
    const asError = reason instanceof Error ? reason : null;
    record({
      kind: "unhandledrejection",
      message: asError?.message ?? String(reason),
      stack: asError?.stack ?? null,
    });
  });
}

interface RootCrashBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

/**
 * Root error boundary. Catches render/commit-phase throws from anywhere below
 * it, records the error + component stack, and renders a minimal inline
 * fallback (the consolidated, copyable record lives in the DOM overlay).
 */
export class RootCrashBoundary extends Component<
  { children: ReactNode },
  RootCrashBoundaryState
> {
  state: RootCrashBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(
    error: Error,
  ): Partial<RootCrashBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const componentStack = errorInfo.componentStack ?? null;
    this.setState({ componentStack });
    record({
      kind: "render",
      message: error.message,
      stack: error.stack ?? null,
      componentStack,
    });
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 16,
            font: "13px/1.5 ui-monospace,Menlo,monospace",
            color: "#ffd9d9",
            background: "#3a0d0d",
            height: "100%",
            overflow: "auto",
            whiteSpace: "pre-wrap",
            userSelect: "text",
          }}
        >
          <strong>Render crash captured — see the red overlay (Copy).</strong>
          {"\n\n"}
          {this.state.error.message}
          {this.state.componentStack ? `\n${this.state.componentStack}` : ""}
        </div>
      );
    }
    return this.props.children;
  }
}
