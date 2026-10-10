import { useEffect, useState } from "react";

/** Querying permission never prompts. Unsupported browsers remain unknown. */
export function useSidecarNetworkPermission(endpoint: string) {
  const [state, setState] = useState<PermissionState | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cleanup: (() => void) | undefined;
    setState(null);

    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- The Permissions API is absent in some browsers and embedded webviews.
      if (!navigator.permissions?.query) return;
      const hostname = new URL(endpoint, window.location.href).hostname;
      const loopback =
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname === "[::1]" ||
        /^127\./.test(hostname);
      // Modern Chromium splits local applications from LAN access. Fall back
      // only when the specific permission is unsupported, not when denied.
      for (const name of [
        loopback ? "loopback-network" : "local-network",
        "local-network-access",
      ]) {
        try {
          const status = await navigator.permissions.query({
            // These permission names are not yet included in TypeScript's DOM types.
            name: name as PermissionName,
          });
          if (controller.signal.aborted) return;
          const update = () => setState(status.state);
          status.addEventListener("change", update);
          cleanup = () => status.removeEventListener("change", update);
          update();
          return;
        } catch {
          if (controller.signal.aborted) return;
        }
      }
    })().catch(() => undefined);

    return () => {
      controller.abort();
      cleanup?.();
    };
  }, [endpoint]);

  return state;
}
