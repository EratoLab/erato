import { AddinChatProviderCore } from "../core/AddinChatProviderCore";
import {
  OutlookAddinSessionController,
  computeInitialLifecycle,
  type ComputeInitialLifecycleArgs,
  type SessionLifecycle,
} from "../outlook/OutlookAddinSessionController";

import type { ReactNode } from "react";

export { computeInitialLifecycle };
export type { ComputeInitialLifecycleArgs, SessionLifecycle };

/** Outlook composition of generic chat data with Outlook session policy. */
export function AddinChatProvider({ children }: { children: ReactNode }) {
  return (
    <AddinChatProviderCore
      platform="outlook"
      SessionController={OutlookAddinSessionController}
    >
      {children}
    </AddinChatProviderCore>
  );
}
