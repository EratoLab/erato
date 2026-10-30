import { useCallback, useEffect, useRef } from "react";

import { fetchProfile } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { useClientToolFileApprovalStore } from "./store/clientToolFileApprovalStore";
import { useConfirmationRegistryStore } from "./store/confirmationRegistryStore";
import { useGenerationStatusStore } from "./store/generationStatusStore";

import type { ClientToolCallContext } from "./clientToolExecutors";
import type { ClientToolFileApprovalRequest } from "./store/clientToolFileApprovalStore";
import type { ChatGenerationStatus } from "./store/generationStatusStore";

let nextRequestId = 0;

/** The owner chat's status before its first open task prompt, and the entry
 * that prompt seeded over it. */
const interruptedOwners = new Map<
  string,
  {
    saved: ChatGenerationStatus | undefined;
    seeded: ChatGenerationStatus | undefined;
  }
>();

export function useClientToolFileApproval() {
  const mounted = useRef(false);
  const pending = useRef(new Set<ClientToolFileApprovalRequest>());
  useEffect(() => {
    mounted.current = true;
    const active = pending.current;
    return () => {
      mounted.current = false;
      for (const request of active) request.finish(new Set());
    };
  }, []);

  const approveFiles = useCallback(
    async (
      files: File[],
      context: ClientToolCallContext,
      outlookProvenance?: ClientToolFileApprovalRequest["outlookProvenance"],
    ): Promise<ReadonlySet<File>> => {
      const { signal, chatId, hostGrant } = context;
      signal?.throwIfAborted();
      if (!chatId || !context.messageId) return new Set();
      // A task's call asks in the chat the user works in, the owner of the
      // grant, not in the task's own chat that nobody watches.
      const target = hostGrant?.ownerChatId ?? chatId;
      // Read the backend preference at each gate, including changes in other tabs.
      const profile = await fetchProfile({}, signal);
      signal?.throwIfAborted();
      if (!mounted.current) return new Set();
      if (profile.client_tool_file_approval === "always_allow")
        return new Set(files);
      if (profile.client_tool_file_approval === "never_allow") return new Set();
      return new Promise((resolve) => {
        const abort = () => request.finish(new Set());
        const request: ClientToolFileApprovalRequest = {
          id: nextRequestId++,
          files,
          outlookProvenance,
          selected: new Set(files),
          context,
          finish: (approved) => {
            signal?.removeEventListener("abort", abort);
            if (!pending.current.delete(request)) return;
            useClientToolFileApprovalStore.setState((state) => ({
              requests: state.requests.filter((item) => item.id !== request.id),
            }));
            useConfirmationRegistryStore
              .getState()
              .unregisterConfirmation(target, String(request.id));
            if (!useConfirmationRegistryStore.getState().hasPending(target)) {
              const status = useGenerationStatusStore.getState();
              const interrupted = interruptedOwners.get(target);
              interruptedOwners.delete(target);
              // The owner turn keeps running or stays parked on its tasks, so
              // it gets back what it showed; a tombstone stamped now would
              // outrank every later poll of that generation.
              if (interrupted)
                status.restoreStatus(
                  target,
                  interrupted.seeded,
                  interrupted.saved,
                );
              else if (signal?.aborted) status.markApprovalDecided(target);
              else status.seedRunning(target, new Date().toISOString());
            }
            resolve(approved);
          },
        };
        pending.current.add(request);
        signal?.addEventListener("abort", abort, { once: true });
        useClientToolFileApprovalStore.setState((state) => ({
          requests: [...state.requests, request],
        }));
        const asking = useConfirmationRegistryStore.getState();
        const first = !asking.hasPending(target);
        asking.registerConfirmation(target, String(request.id));
        const statusOf = () =>
          useGenerationStatusStore.getState().statusByChatId[target];
        const before = statusOf();
        const earlier = first ? undefined : interruptedOwners.get(target);
        useGenerationStatusStore
          .getState()
          .seedActionRequired(target, new Date().toISOString());
        if ((first && hostGrant) || earlier)
          interruptedOwners.set(target, {
            // What the server reported since the last prompt is newer.
            saved:
              earlier && before === earlier.seeded ? earlier.saved : before,
            seeded: statusOf(),
          });
      });
    },
    [],
  );

  return { approveFiles };
}
