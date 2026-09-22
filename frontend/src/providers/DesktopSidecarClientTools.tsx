import { useEffect } from "react";

import { registerClientToolExecutor } from "@/hooks/chat/clientToolExecutors";
import { useClientToolFileApproval } from "@/hooks/chat/useClientToolFileApproval";
import { createSidecarChatTools } from "@/lib/desktopSidecar/chatTools";
import {
  fetchUploadFile,
  type UploadFileVariables,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { useDesktopSidecar } from "./DesktopSidecarProvider";
import { useChatInputFeature, useUploadFeature } from "./FeatureConfigProvider";

/** The same configurable client tools in the web app and all add-in hosts. */
export function DesktopSidecarClientTools() {
  const { client } = useDesktopSidecar();
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
      uploadAttachment: async (file, chatId, signal) => {
        const body = new FormData();
        body.append("file", file, file.name);
        const response = await fetchUploadFile(
          {
            queryParams: { chat_id: chatId },
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
    const unregister = tools.map((tool) =>
      registerClientToolExecutor(tool.name, tool.execute, tool.isAvailable),
    );
    return () => unregister.forEach((cleanup) => cleanup());
  }, [client, enabled, maxSizeBytes, maxFiles, approveFiles]);
  return null;
}
