import { t } from "@lingui/core/macro";

import { useConnectivityStatus } from "@/lib/connectivity/useConnectivityStatus";

import { Alert } from "../Alert";

import type React from "react";

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
