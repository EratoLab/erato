import type { HostShell } from "./hostShell";

/** Host capability: the page may take the left screen edge from the host's back swipe. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- capability name
export const LEFT_EDGE_SWIPE_CAPABILITY = "leftEdgeSwipe";

const RELEASE_DELAY_MS = 300;

let holders = 0;
let claimed = false;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;
let listening = false;
let latestShell: HostShell | undefined;

function send(shell: HostShell, value: boolean) {
  claimed = value;
  // eslint-disable-next-line lingui/no-unlocalized-strings -- shell method
  shell.request("leftEdgeSwipe.claim", { claimed: value }).catch(() => {
    claimed = false;
  });
}

/**
 * Holds the left screen edge while at least one caller does. A release waits
 * a moment, so a sidebar that mounts again on the next page keeps the edge
 * instead of a release overtaking its new claim.
 */
export function claimLeftEdge(shell: HostShell): () => void {
  holders += 1;
  latestShell = shell;
  clearTimeout(releaseTimer);
  if (!claimed) {
    send(shell, true);
  }
  if (!listening) {
    listening = true;
    // The host gives the edge back whenever a page starts to show, a return
    // from the back-forward cache included.
    window.addEventListener("pageshow", (event) => {
      if (event.persisted && holders > 0 && latestShell) {
        send(latestShell, true);
      }
    });
  }
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    holders -= 1;
    if (holders > 0) {
      return;
    }
    releaseTimer = setTimeout(() => {
      if (holders === 0 && claimed) {
        send(shell, false);
      }
    }, RELEASE_DELAY_MS);
  };
}
