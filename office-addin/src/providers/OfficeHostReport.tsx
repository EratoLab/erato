import { reportOfficeHostStart } from "@erato/frontend/library";
import { useEffect } from "react";

import { useOffice } from "./OfficeProvider";

import type { OfficeHostReport as OfficeHostReportBody } from "@erato/frontend/library";

/**
 * Tells the backend once per pane start which Office host and platform this pane runs on. Mounted
 * inside AuthGate, so the report goes out on a signed-in request.
 */
export function OfficeHostReport({
  details,
}: {
  /** Host-specific fields read when the report is sent, e.g. PowerPoint's read tier. */
  details?: () => Pick<OfficeHostReportBody, "apiSet" | "tier">;
}) {
  const { host, platform } = useOffice();
  useEffect(() => {
    if (!host) return;
    void reportOfficeHostStart({
      host,
      ...(platform ? { platform } : {}),
      ...details?.(),
    });
    // Once per pane: later renders must not report again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);
  return null;
}
