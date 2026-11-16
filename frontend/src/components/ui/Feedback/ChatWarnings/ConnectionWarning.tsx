import { t } from "@lingui/core/macro";

import { useConnectivityStatus } from "@/lib/connectivity/useConnectivityStatus";

import { Alert } from "../Alert";

import type React from "react";

/**
 * Shown while the server cannot be reached. Requests wait and a running
 * answer reattaches on their own once the connection is back.
 */
export const ConnectionWarning: React.FC = () => {
  const status = useConnectivityStatus();
  if (status !== "offline") {
    return null;
  }
  return (
    <Alert
      type="warning"
      geometryVariant="message"
      role="status"
      data-testid="connection-warning"
    >
      {t({
        id: "chat.connection.lost",
        message: "Connection lost. Reconnecting…",
      })}
    </Alert>
  );
};
