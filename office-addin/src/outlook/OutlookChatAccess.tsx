import { componentRegistry } from "@erato/frontend/library";
import {
  Component,
  Suspense,
  useCallback,
  useLayoutEffect,
  useState,
} from "react";

import type {
  AddinChatAccess,
  AddinChatAccessProviderProps,
} from "@erato/frontend/library";
import type { ComponentType, ReactNode } from "react";

const LOADING: AddinChatAccess = { status: "loading" };
const ERROR: AddinChatAccess = { status: "error" };
const ALLOWED: AddinChatAccess = { status: "allowed" };

type PublishDecision = (access: AddinChatAccess, retry?: () => void) => void;

class AccessPolicyBoundary extends Component<
  { children: ReactNode; fallback: (reset: () => void) => ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  reset = () => this.setState({ failed: false });

  render() {
    return this.state.failed
      ? this.props.fallback(this.reset)
      : this.props.children;
  }
}

/** Publish before paint without updating a parent from the policy's render. */
function PolicyDecision({
  access,
  publish,
  retry,
}: {
  access: AddinChatAccess;
  publish: PublishDecision;
  retry?: () => void;
}) {
  // Kits execute JavaScript at runtime, so a typed contract cannot exclude a
  // missing or malformed decision. Only the validated status leaves the bridge.
  const status =
    access && ["loading", "allowed", "denied", "error"].includes(access.status)
      ? access.status
      : "error";
  useLayoutEffect(() => {
    publish({ status }, retry);
    // Dropping the reporter (or hiding it through Suspense) invalidates the
    // grant too. A policy returning null must not leave its last grant active.
    return () => publish(LOADING);
  }, [publish, status, retry]);
  return null;
}

interface ChatAccessProps {
  platform: string;
  children: (access: AddinChatAccess, retry?: () => void) => ReactNode;
}

function ResolvedPolicy({
  Policy,
  platform,
  children,
}: ChatAccessProps & {
  Policy: ComponentType<AddinChatAccessProviderProps>;
}) {
  const [decision, setDecision] = useState<{
    access: AddinChatAccess;
    retry?: () => void;
  }>({ access: LOADING });
  const publish = useCallback<PublishDecision>((access, retry) => {
    setDecision((previous) =>
      previous.access.status === access.status && previous.retry === retry
        ? previous
        : { access, retry },
    );
  }, []);

  return (
    <>
      <AccessPolicyBoundary
        fallback={(retry) => (
          <PolicyDecision access={ERROR} publish={publish} retry={retry} />
        )}
      >
        <Suspense
          fallback={<PolicyDecision access={LOADING} publish={publish} />}
        >
          <Policy platform={platform}>
            {(access) => <PolicyDecision access={access} publish={publish} />}
          </Policy>
        </Suspense>
      </AccessPolicyBoundary>
      {/* Pane errors belong to the pane's boundaries, never to access policy. */}
      {children(decision.access, decision.retry)}
    </>
  );
}

/** A missing optional policy allows; a required or broken policy never does. */
export function OutlookChatAccess({ platform, children }: ChatAccessProps) {
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
    <ResolvedPolicy Policy={Policy} platform={platform}>
      {children}
    </ResolvedPolicy>
  );
}
