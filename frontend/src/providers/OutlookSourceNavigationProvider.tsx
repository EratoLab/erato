import { createContext, useContext } from "react";

import type { OutlookMessageReference } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

export interface OutlookSourceNavigator {
  canOpen: (reference: OutlookMessageReference) => boolean;
  open: (reference: OutlookMessageReference) => Promise<void>;
}

const OutlookSourceNavigationContext =
  createContext<OutlookSourceNavigator | null>(null);

/** An Outlook host supplies Office.js; other hosts use the shared sidecar link. */
export function OutlookSourceNavigationProvider({
  navigator,
  children,
}: {
  navigator: OutlookSourceNavigator | null;
  children: ReactNode;
}) {
  return (
    <OutlookSourceNavigationContext.Provider value={navigator}>
      {children}
    </OutlookSourceNavigationContext.Provider>
  );
}

export const useOutlookSourceNavigator = () =>
  useContext(OutlookSourceNavigationContext);
