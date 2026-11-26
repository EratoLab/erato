import { t } from "@lingui/core/macro";

import { useFileUploadStore } from "@/hooks/files/useFileUploadStore";
import { useConnectivityStatus } from "@/lib/connectivity/useConnectivityStatus";

import { Alert } from "../Alert";

import type React from "react";

export const ConnectionWarning: React.FC = () => {
  const status = useConnectivityStatus();
  const uploadWaiting = useFileUploadStore(
    (state) => state.isWaitingForNetwork,
  );
  if (status !== "offline" && !uploadWaiting) {
    return null;
  }
  return (
    <Alert
      type="warning"
      geometryVariant="message"
      role="status"
      data-testid="connection-warning"
    >
      {uploadWaiting
        ? t({
            id: "upload.waitingForNetwork",
            message:
              "Waiting for the network. The upload continues once the connection is back.",
          })
        : t({
            id: "chat.connection.lost",
            message: "Connection lost. Reconnecting…",
          })}
    </Alert>
  );
};
