import { componentRegistry } from "@erato/frontend/library";
import { Component, Suspense } from "react";

import type {
  AddinChatAccess,
  AddinChatAccessProviderProps,
} from "@erato/frontend/library";
import type { ReactNode } from "react";

const LOADING: AddinChatAccess = { status: "loading" };
const ERROR: AddinChatAccess = { status: "error" };
const ALLOWED: AddinChatAccess = { status: "allowed" };

class AccessPolicyBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** A missing optional policy allows; a required or broken policy never does. */
export function OutlookChatAccess({
  platform,
  children,
}: AddinChatAccessProviderProps) {
  const Policy = componentRegistry.AddinChatAccessProvider;
  if (!Policy) {
    const required = window.ERATO_ADDIN_CHAT_ACCESS_POLICY_REQUIRED;
    return children(
      required === undefined || required === false || required === "false"
        ? ALLOWED
        : ERROR,
    );
  }

  return (
    <AccessPolicyBoundary fallback={children(ERROR)}>
      <Suspense fallback={children(LOADING)}>
        <Policy platform={platform}>
          {(access) =>
            // Kits execute JavaScript at runtime; don't trust the TypeScript
            // contract to rule out a missing or malformed decision.
            children(
              access &&
                ["loading", "allowed", "denied", "error"].includes(
                  access.status,
                )
                ? access
                : ERROR,
            )
          }
        </Policy>
      </Suspense>
    </AccessPolicyBoundary>
  );
}
