/**
 * Module-level singleton that registers exactly one Office.js
 * `DragAndDropEvent` handler regardless of how many React components
 * subscribe. This is the canonical early-2026 pattern for binding a single
 * Office.js event across React 18/19 StrictMode mounts, where effect
 * double-invocation would otherwise race `addHandlerAsync`/`removeHandlerAsync`
 * and leave two handlers registered (the root cause of visible drops being
 * processed twice).
 *
 * Design:
 *   - Subscribers register via `subscribe({ onDragover, onDrop })` and get
 *     back an idempotent `unsubscribe` callback.
 *   - The Office.js handler is installed lazily on the first subscriber and
 *     removed only when the last subscriber leaves.
 *   - An internal `installState` (`idle | pending | installed | failed`)
 *     gates the async registration so that a `subscribe`/`unsubscribe` pair
 *     occurring during a pending `addHandlerAsync` resolves deterministically:
 *     the registration callback tears down immediately if the subscriber set
 *     went empty while it was in flight.
 *   - Subscriber callbacks are isolated — one throwing doesn't break others.
 */

export interface OfficeDragAndDropSubscriber {
  onDragover: () => void;
  onDrop: (files: File[]) => void;
}

type InstallState = "idle" | "pending" | "installed" | "failed";

const subscribers = new Set<OfficeDragAndDropSubscriber>();
let installState: InstallState = "idle";

export function subscribeToOfficeDragAndDrop(
  subscriber: OfficeDragAndDropSubscriber,
): () => void {
  subscribers.add(subscriber);
  installIfNeeded();
  let unsubscribed = false;
  return () => {
    if (unsubscribed) {
      return;
    }
    unsubscribed = true;
    subscribers.delete(subscriber);
    if (subscribers.size === 0 && installState === "installed") {
      teardown();
    }
  };
}

function installIfNeeded(): void {
  if (
    installState === "pending" ||
    installState === "installed" ||
    installState === "failed"
  ) {
    return;
  }
  if (!isDragAndDropEventSupported()) {
    installState = "failed";
    return;
  }
  installState = "pending";
  try {
    Office.context.mailbox.addHandlerAsync(
      Office.EventType.DragAndDropEvent,
      handleOfficeEvent,
      (result) => {
        if (result.status !== Office.AsyncResultStatus.Succeeded) {
          installState = "failed";
          console.warn(
            "[officeDragAndDropBroker] addHandlerAsync failed:",
            result.error?.message,
          );
          return;
        }
        installState = "installed";
        // If subscribers left while we were registering, tear down now.
        if (subscribers.size === 0) {
          teardown();
        }
      },
    );
  } catch (error) {
    installState = "failed";
    console.warn(
      "[officeDragAndDropBroker] addHandlerAsync threw:",
      error,
    );
  }
}

function teardown(): void {
  if (installState !== "installed") {
    return;
  }
  installState = "idle";
  try {
    Office.context.mailbox.removeHandlerAsync(
      Office.EventType.DragAndDropEvent,
      () => {},
    );
  } catch {
    // Office host may be unloading; best-effort cleanup only.
  }
}

function handleOfficeEvent(event: Office.DragAndDropEventArgs): void {
  const data = event.dragAndDropEventData;
  if (data.type === "dragover") {
    for (const subscriber of subscribers) {
      try {
        subscriber.onDragover();
      } catch (error) {
        console.warn(
          "[officeDragAndDropBroker] onDragover listener threw:",
          error,
        );
      }
    }
    return;
  }
  if (data.type === "drop") {
    const files = (data.dataTransfer?.files ?? []).map(toFile);
    for (const subscriber of subscribers) {
      try {
        subscriber.onDrop(files);
      } catch (error) {
        console.warn(
          "[officeDragAndDropBroker] onDrop listener threw:",
          error,
        );
      }
    }
  }
}

function toFile(item: Office.DroppedItemDetails): File {
  return new File([item.fileContent], item.name, { type: item.type });
}

function isDragAndDropEventSupported(): boolean {
  try {
    if (typeof Office === "undefined" || !Office.context?.requirements) {
      return false;
    }
    return Office.context.requirements.isSetSupported("Mailbox", "1.5");
  } catch {
    return false;
  }
}

/** Test-only hook to reset the module state between test cases. */
export function __resetOfficeDragAndDropBrokerForTests(): void {
  subscribers.clear();
  installState = "idle";
}
