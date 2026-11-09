import {
  ClientToolOperationHandler,
  clientOperationDeviceId,
  registerClientOperationHandler,
  registerOperationExecutor,
  requestClientOperationSweep,
} from "@erato/frontend/library";
import { useCallback, useEffect, useRef } from "react";

import { wordDocumentOperationBinding } from "../utils/wordDocumentOperationBinding";
import {
  wordDocumentReadSession,
  WORD_READ_TOOL,
} from "../utils/wordDocumentReadTool";
import { WORD_SUBMIT_PLAN_TOOL } from "../utils/wordDocumentSubmission";

import type { ExecutorBinding } from "@erato/frontend/library";

/** Registers the pane's operation executors; returns a stable getter of its binding's identity,
 * the scope id the server derives for a document approval. */
export function useWordClientOperations(
  documentIdentity: string,
): () => string | undefined {
  const current = useRef<
    { documentIdentity: string; binding: ExecutorBinding } | undefined
  >(undefined);
  const identity = useRef(documentIdentity);
  identity.current = documentIdentity;
  const binding = useCallback(
    () =>
      current.current?.documentIdentity === identity.current
        ? current.current.binding
        : undefined,
    [],
  );
  useEffect(() => {
    let active = true;
    void wordDocumentOperationBinding(
      documentIdentity,
      clientOperationDeviceId(),
    ).then(
      (made) => {
        if (!active || !made) return;
        current.current = { documentIdentity, binding: made };
        requestClientOperationSweep();
      },
      () => {},
    );
    return () => {
      active = false;
      current.current = undefined;
    };
  }, [documentIdentity]);
  useEffect(() => {
    const dispose = [
      registerOperationExecutor(WORD_READ_TOOL, binding, { yields: true }),
      registerOperationExecutor(WORD_SUBMIT_PLAN_TOOL, binding, {
        yields: true,
      }),
      registerClientOperationHandler(
        new ClientToolOperationHandler(
          WORD_READ_TOOL,
          wordDocumentReadSession.execute,
          binding,
        ),
      ),
    ];
    return () => {
      dispose.forEach((unregister) => unregister());
    };
  }, [binding]);
  return useCallback(() => binding()?.host_context?.identity, [binding]);
}
