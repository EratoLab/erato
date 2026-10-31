import { useEffect } from "react";

import {
  registerClientToolExecutor,
  registerLocalOnlyClientTools,
} from "@/hooks/chat/clientToolExecutors";
import { useClientToolFileApproval } from "@/hooks/chat/useClientToolFileApproval";
import { ClientToolOperationHandler } from "@/lib/clientOperations/clientToolHandler";
import { clientOperationDeviceId } from "@/lib/clientOperations/deviceId";
import {
  registerClientOperationHandler,
  requestClientOperationSweep,
} from "@/lib/clientOperations/handlers";
import { registerOperationExecutor } from "@/lib/clientOperations/registration";
import { desktopSidecarBinding } from "@/lib/desktopSidecar/binding";
import { createSidecarChatTools } from "@/lib/desktopSidecar/chatTools";
import {
  fetchUploadFile,
  type UploadFileVariables,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { useDesktopSidecar } from "./DesktopSidecarProvider";
import { useChatInputFeature, useUploadFeature } from "./FeatureConfigProvider";

/** The same configurable client tools in the web app and all add-in hosts. */
export function DesktopSidecarClientTools() {
  const { client, snapshot } = useDesktopSidecar();
  const { approveFiles } = useClientToolFileApproval();
  const { enabled, maxSizeBytes } = useUploadFeature();
  const { maxFiles } = useChatInputFeature();

  useEffect(() => {
    if (!client) return;
    const tools = createSidecarChatTools(client, {
      approveFiles,
      uploadsEnabled: enabled,
      maxUploadBytes: maxSizeBytes,
      maxFiles,
      uploadAttachment: async (
        file,
        chatId,
        signal,
        externalIdEwsId,
        provenance,
      ) => {
        const body = new FormData();
        if (provenance)
          body.append("outlook_provenance", JSON.stringify(provenance));
        body.append("file", file, file.name);
        const response = await fetchUploadFile(
          {
            queryParams: {
              chat_id: chatId,
              ...(externalIdEwsId !== undefined
                ? { external_id_ews_id: externalIdEwsId }
                : {}),
            },
            body: body as unknown as UploadFileVariables["body"],
          },
          signal,
        );
        const uploaded = response.files.at(0);
        if (!uploaded)
          throw new Error("The attachment upload returned no file.");
        return uploaded;
      },
    });
    // Any delegation declaration blocks legacy content, even if strict support
    // is unavailable or unknown. Fail closed; never fall back to raw RPCs.
    const unguard = registerLocalOnlyClientTools(
      tools.map((tool) => tool.name),
      () => Boolean(client.getSnapshot().localDelegation),
    );
    // A turn sent while the app is not running carries no binding, so none of
    // its tasks waits for the app.
    const deviceId = clientOperationDeviceId();
    const binding = () =>
      tools.some((tool) => tool.isAvailable())
        ? desktopSidecarBinding(client.getSnapshot(), deviceId)
        : undefined;
    const unregister = tools.flatMap((tool) => [
      registerClientToolExecutor(tool.name, tool.execute, tool.isAvailable, {
        acceptsGrantCalls: true,
      }),
      registerOperationExecutor(tool.name, binding, { additional: true }),
      registerClientOperationHandler(
        new ClientToolOperationHandler(
          tool.name,
          tool.execute,
          binding,
          tool.isAvailable,
        ),
      ),
    ]);
    return () => {
      unguard();
      unregister.forEach((cleanup) => cleanup());
    };
  }, [client, enabled, maxSizeBytes, maxFiles, approveFiles]);

  // The binding follows the app; a sweep opens or closes its stream at once
  // instead of on the next poll.
  useEffect(() => {
    requestClientOperationSweep();
  }, [snapshot.state, snapshot.instanceId, snapshot.localDelegation]);
  return null;
}
