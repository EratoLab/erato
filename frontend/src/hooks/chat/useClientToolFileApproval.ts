import { useCallback, useEffect, useRef } from "react";

import { fetchProfile } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { useClientToolFileApprovalStore } from "./store/clientToolFileApprovalStore";
import { useConfirmationRegistryStore } from "./store/confirmationRegistryStore";
import { useGenerationStatusStore } from "./store/generationStatusStore";

import type { ClientToolCallContext } from "./clientToolExecutors";
import type { ClientToolFileApprovalRequest } from "./store/clientToolFileApprovalStore";

let nextRequestId = 0;

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
    ): Promise<ReadonlySet<File>> => {
      const { signal, chatId } = context;
      signal?.throwIfAborted();
      if (!chatId || !context.messageId) return new Set();
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
          selected: new Set(files),
          context,
          finish: (approved) => {
            signal?.removeEventListener("abort", abort);
            if (!pending.current.delete(request)) return;
            useClientToolFileApprovalStore.setState((state) => ({
              requests: state.requests.filter((item) => item.id !== request.id),
            }));
            if (chatId) {
              useConfirmationRegistryStore
                .getState()
                .unregisterConfirmation(chatId, String(request.id));
              if (!useConfirmationRegistryStore.getState().hasPending(chatId)) {
                const status = useGenerationStatusStore.getState();
                if (signal?.aborted) status.markApprovalDecided(chatId);
                else status.seedRunning(chatId, new Date().toISOString());
              }
            }
            resolve(approved);
          },
        };
        pending.current.add(request);
        signal?.addEventListener("abort", abort, { once: true });
        useClientToolFileApprovalStore.setState((state) => ({
          requests: [...state.requests, request],
        }));
        if (chatId) {
          useConfirmationRegistryStore
            .getState()
            .registerConfirmation(chatId, String(request.id));
          useGenerationStatusStore
            .getState()
            .seedActionRequired(chatId, new Date().toISOString());
        }
      });
    },
    [],
  );

  return { approveFiles };
}
