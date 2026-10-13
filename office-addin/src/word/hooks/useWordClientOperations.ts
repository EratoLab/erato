import {
  ClientToolOperationHandler,
  clientOperationDeviceId,
  registerClientOperationHandler,
  registerOperationExecutor,
  requestClientOperationSweep,
} from "@erato/frontend/library";
import { useEffect, useRef } from "react";

import { wordDocumentOperationBinding } from "../utils/wordDocumentOperationBinding";
import {
  wordDocumentReadSession,
  WORD_READ_TOOL,
} from "../utils/wordDocumentReadTool";
import { WORD_SUBMIT_PLAN_TOOL } from "../utils/wordDocumentSubmission";

import type { ExecutorBinding } from "@erato/frontend/library";

export function useWordClientOperations(documentIdentity: string): void {
  const current = useRef<
    { documentIdentity: string; binding: ExecutorBinding } | undefined
  >(undefined);
  const identity = useRef(documentIdentity);
  identity.current = documentIdentity;
  useEffect(() => {
    let active = true;
    void wordDocumentOperationBinding(
      documentIdentity,
      clientOperationDeviceId(),
    ).then(
      (binding) => {
        if (!active || !binding) return;
        current.current = { documentIdentity, binding };
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
    const binding = () =>
      current.current?.documentIdentity === identity.current
        ? current.current.binding
        : undefined;
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
  }, []);
}
