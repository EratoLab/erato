import {
  ClientToolOperationHandler,
  clientOperationDeviceId,
  registerClientOperationHandler,
  registerClientToolExecutor,
  registerOperationExecutor,
  requestClientOperationSweep,
} from "@erato/frontend/library";
import { useEffect, useRef } from "react";

import { useOutlookCalendarFetcher } from "./useOutlookCalendarFetcher";
import { useOffice } from "../../providers/OfficeProvider";
import {
  FETCH_AVAILABILITY_TOOL_NAME,
  createFetchAvailabilityExecutor,
} from "../utils/outlookScheduleTool";

import type { ExecutorBinding } from "@erato/frontend/library";

export const OUTLOOK_MAILBOX_HOST_CONTEXT = "outlook_mailbox";

/** SHA-256 hex of the normalized address, so no raw address leaves the pane. */
export async function outlookMailboxDigest(
  emailAddress: string,
): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(emailAddress.trim().toLowerCase()),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Register this add-in's client-tool executors with the shared streaming
 * loop's registry (see `clientToolExecutors.ts` in the frontend library).
 * Registered once for the component's lifetime; the calendar fetcher is read
 * through a ref per call so backend selection (EWS vs Graph, auth becoming
 * ready) is always current without re-registering. A `fetch_availability`
 * call while no fetcher applies returns a clean error result, so the backend
 * resumes immediately instead of parking to timeout.
 *
 * It also finishes parked `fetch_availability` operations for this device and
 * mailbox; the binding only routes, the fetcher decides whether this pane claims.
 */
export function useOutlookClientTools(): void {
  const { fetcher } = useOutlookCalendarFetcher();
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const emailAddress = useOffice().mailboxUser?.emailAddress;
  const mailboxRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    mailboxRef.current = undefined;
    if (!emailAddress?.trim()) return;
    let current = true;
    outlookMailboxDigest(emailAddress).then(
      (digest) => {
        if (!current) return;
        mailboxRef.current = digest;
        requestClientOperationSweep();
      },
      // Without WebCrypto there is no binding; calls keep the in-memory path.
      () => {},
    );
    return () => {
      current = false;
    };
  }, [emailAddress]);

  useEffect(() => {
    const execute = createFetchAvailabilityExecutor(() => fetcherRef.current);
    const deviceId = clientOperationDeviceId();
    const binding = (): ExecutorBinding | undefined => {
      const identity = mailboxRef.current;
      return deviceId && identity
        ? {
            device_id: deviceId,
            realm: "office-addin",
            host_context: { kind: OUTLOOK_MAILBOX_HOST_CONTEXT, identity },
          }
        : undefined;
    };
    const unregister = [
      registerClientToolExecutor(FETCH_AVAILABILITY_TOOL_NAME, execute),
      registerOperationExecutor(FETCH_AVAILABILITY_TOOL_NAME, binding, {
        yields: true,
      }),
      registerClientOperationHandler(
        new ClientToolOperationHandler(
          FETCH_AVAILABILITY_TOOL_NAME,
          execute,
          binding,
          () => fetcherRef.current !== null,
        ),
      ),
    ];
    return () => {
      unregister.forEach((dispose) => dispose());
    };
  }, []);
}
