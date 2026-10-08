import { callOfficeAsync } from "../utils/officeAsync";

/**
 * Registers exactly one Office.js `DocumentSelectionChanged` handler however many components
 * subscribe, following officeDragAndDropBroker: StrictMode's mount/unmount/mount must not race
 * `addHandlerAsync`/`removeHandlerAsync` into two handlers. Registration goes through
 * callOfficeAsync with a timeout, because a host that never answers would otherwise leave the
 * broker pending for the whole session.
 */

export interface OfficeSelectionChangedSubscriber {
  onSelectionChanged: () => void;
  /** The host offers no selection events (or refused to register one), so none will arrive. */
  onUnavailable?: () => void;
}

type InstallState = "idle" | "pending" | "installed" | "failed";

const REGISTRATION_TIMEOUT_MS = 5000;

const subscribers = new Set<OfficeSelectionChangedSubscriber>();
let installState: InstallState = "idle";

export function subscribeToOfficeSelectionChanged(
  subscriber: OfficeSelectionChangedSubscriber,
): () => void {
  subscribers.add(subscriber);
  if (installState === "failed") notifyUnavailable([subscriber]);
  else installIfNeeded();
  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    subscribers.delete(subscriber);
    if (subscribers.size === 0 && installState === "installed") teardown();
  };
}

function installIfNeeded(): void {
  if (installState !== "idle") return;
  const host = officeDocument();
  if (!host) {
    fail("Office document events are not available");
    return;
  }
  installState = "pending";
  callOfficeAsync<void>(
    (callback) =>
      host.addHandlerAsync(
        Office.EventType.DocumentSelectionChanged,
        handleSelectionChanged,
        callback,
      ),
    { timeoutMs: REGISTRATION_TIMEOUT_MS },
  ).then(
    () => {
      installState = "installed";
      if (subscribers.size === 0) teardown();
    },
    (error: unknown) => {
      fail(error instanceof Error ? error.message : "addHandlerAsync failed");
    },
  );
}

function fail(reason: string): void {
  installState = "failed";
  console.warn("[officeSelectionChangedBroker] registration failed:", reason);
  notifyUnavailable([...subscribers]);
}

function teardown(): void {
  if (installState !== "installed") return;
  installState = "idle";
  try {
    officeDocument()?.removeHandlerAsync(
      Office.EventType.DocumentSelectionChanged,
      { handler: handleSelectionChanged },
      () => {},
    );
  } catch {
    // Office host may be unloading; best-effort cleanup only.
  }
}

function officeDocument(): Office.Document | null {
  try {
    const host =
      typeof Office === "undefined" ? undefined : Office.context?.document;
    return typeof host?.addHandlerAsync === "function" ? host : null;
  } catch {
    return null;
  }
}

function handleSelectionChanged(): void {
  for (const subscriber of [...subscribers]) {
    try {
      subscriber.onSelectionChanged();
    } catch (error) {
      warnListenerThrew("onSelectionChanged", error);
    }
  }
}

function notifyUnavailable(targets: OfficeSelectionChangedSubscriber[]): void {
  for (const subscriber of targets) {
    try {
      subscriber.onUnavailable?.();
    } catch (error) {
      warnListenerThrew("onUnavailable", error);
    }
  }
}

// A listener's error may quote the selected text, so only its kind is logged.
function warnListenerThrew(listener: string, error: unknown): void {
  console.warn(
    `[officeSelectionChangedBroker] ${listener} listener threw:`,
    error instanceof Error ? error.name : typeof error,
  );
}

/** Test-only hook to reset the module state between test cases. */
export function __resetOfficeSelectionChangedBrokerForTests(): void {
  subscribers.clear();
  installState = "idle";
}
