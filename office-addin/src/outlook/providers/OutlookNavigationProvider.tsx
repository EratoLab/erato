import { OutlookSourceNavigationProvider } from "@erato/frontend/library";
import { useMemo } from "react";

import { useOffice } from "../../providers/OfficeProvider";
import { createOutlookSourceNavigator } from "../utils/outlookSourceNavigator";

import type { ReactNode } from "react";

export function OutlookNavigationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { isReady, host, platform } = useOffice();
  const navigator = useMemo(
    () =>
      isReady &&
      host === "Outlook" &&
      platform !== "iOS" &&
      platform !== "Android"
        ? createOutlookSourceNavigator()
        : null,
    [isReady, host, platform],
  );
  return (
    <OutlookSourceNavigationProvider navigator={navigator}>
      {children}
    </OutlookSourceNavigationProvider>
  );
}
