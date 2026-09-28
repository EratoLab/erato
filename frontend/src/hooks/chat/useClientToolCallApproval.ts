import { useCallback, useEffect, useRef } from "react";

import { fetchProfile } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { useClientToolCallApprovalStore } from "./store/clientToolCallApprovalStore";
import { useConfirmationRegistryStore } from "./store/confirmationRegistryStore";
import { useGenerationStatusStore } from "./store/generationStatusStore";

import type { ClientToolCallContext } from "./clientToolExecutors";
import type { ClientToolCallApprovalRequest } from "./store/clientToolCallApprovalStore";
import type { SidecarToolCallDecision } from "@/lib/desktopSidecar/chatTools";

let nextRequestId = 0;

export function useClientToolCallApproval() {
  const mounted = useRef(false);
  const pending = useRef(new Set<ClientToolCallApprovalRequest>());
  useEffect(() => {
    mounted.current = true;
    const active = pending.current;
    return () => {
      mounted.current = false;
      for (const request of active) request.finish(false);
    };
  }, []);

  const decideCall = useCallback(
    async (
      qualifiedName: string,
      input: unknown,
      context?: ClientToolCallContext,
    ): Promise<SidecarToolCallDecision> => {
      context?.signal?.throwIfAborted();
      // Read the backend preference at each call, including changes in other tabs.
      const profile = await fetchProfile({}, context?.signal);
      context?.signal?.throwIfAborted();
      const decision = profile.client_tool_decisions?.[qualifiedName];
      if (decision === "never_allow") return "disabled";
      if (decision !== "ask") return "allowed";
      if (!mounted.current || !context?.chatId || !context.messageId)
        return "declined";
      const { chatId, signal } = context;
      return new Promise((resolve) => {
        const abort = () => request.finish(false);
        const request: ClientToolCallApprovalRequest = {
          id: nextRequestId++,
          context,
          qualifiedName,
          input,
          finish: (approved) => {
            signal?.removeEventListener("abort", abort);
            if (!pending.current.delete(request)) return;
            useClientToolCallApprovalStore.setState((state) => ({
              requests: state.requests.filter((item) => item.id !== request.id),
            }));
            const registry = useConfirmationRegistryStore.getState();
            registry.unregisterConfirmation(chatId, `tool-${request.id}`);
            if (!registry.hasPending(chatId)) {
              const status = useGenerationStatusStore.getState();
              if (signal?.aborted) status.markApprovalDecided(chatId);
              else status.seedRunning(chatId, new Date().toISOString());
            }
            resolve(approved ? "allowed" : "declined");
          },
        };
        pending.current.add(request);
        signal?.addEventListener("abort", abort, { once: true });
        useClientToolCallApprovalStore.setState((state) => ({
          requests: [...state.requests, request],
        }));
        useConfirmationRegistryStore
          .getState()
          .registerConfirmation(chatId, `tool-${request.id}`);
        useGenerationStatusStore
          .getState()
          .seedActionRequired(chatId, new Date().toISOString());
      });
    },
    [],
  );

  return { decideCall };
}
