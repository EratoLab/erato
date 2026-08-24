import {
  Button,
  ChatBubbleIcon,
  MailIcon,
  componentRegistry,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useState } from "react";

import { dismissSessionToasts } from "./components/sessionAskToast";
import { holdSessionPolicy, releaseSessionPolicy } from "./sessionPolicy";
import { useGraphTokenOptional } from "../core/auth/GraphTokenProvider";

import type { AddinStartViewProps } from "@erato/frontend/library";
import type { CSSProperties, ReactNode } from "react";

// Same composite recipe as the shell's floating controls: an opaque shell-app
// base with the sidebar tone layered on top, so the control stays readable on
// glass themes where the sidebar tone alone is translucent.
const floatingToggleStyle: CSSProperties = {
  backgroundColor: "var(--theme-shell-app, var(--theme-bg-primary))",
  backgroundImage:
    "linear-gradient(var(--theme-shell-sidebar), var(--theme-shell-sidebar))",
  borderColor: "var(--theme-border-divider)",
  borderRadius: "var(--theme-radius-shell)",
  boxShadow: "var(--theme-elevation-shell)",
};

/**
 * Hosts a kit-registered start view (`componentRegistry.AddinStartView`) in
 * the Outlook task pane. With no registration it renders its children
 * untouched — the add-in opens straight into chat exactly as before. With
 * one, the pane opens on the start view and a floating toggle at the top
 * right switches between the start view and the chat.
 *
 * Mounted INSIDE AddinChatProviderCore so chat context, session policy, and
 * any active stream survive the toggle.
 */
export function OutlookStartViewSwitcher({
  platform,
  children,
}: {
  /** Host identifier forwarded to the start view (e.g. "outlook"). */
  platform: string;
  children: ReactNode;
}) {
  const StartView = componentRegistry.AddinStartView;
  const graph = useGraphTokenOptional();
  const [view, setView] = useState<"start" | "chat">("start");

  const openChat = useCallback(() => setView("chat"), []);

  // While the start view is shown, mail-item switches must not surface a
  // session ask toast on top of it (toasts float at z-1000). Same counted
  // gate the history drawer uses: hold defers the anchor policy, releasing
  // re-evaluates the latest state exactly once.
  const startViewActive = StartView !== null && view === "start";
  useEffect(() => {
    if (!startViewActive) return;
    holdSessionPolicy();
    dismissSessionToasts();
    return () => releaseSessionPolicy();
  }, [startViewActive]);

  // Start views request custom-audience API tokens; warming the oauth2-proxy
  // session with one would hand the proxy a token it cannot redeem, so the
  // opportunistic session refresh is skipped for everything acquired here.
  const acquireToken = useMemo<AddinStartViewProps["acquireToken"]>(() => {
    if (!graph) return undefined;
    return (scopes, options) =>
      graph.acquireToken(scopes, { ...options, skipSessionWarm: true });
  }, [graph]);

  if (!StartView) {
    return <>{children}</>;
  }

  const inChat = view === "chat";
  return (
    <div className="relative flex size-full min-w-0 flex-col">
      <Button
        variant="sidebar-icon"
        icon={inChat ? <MailIcon /> : <ChatBubbleIcon />}
        onClick={() => setView(inChat ? "start" : "chat")}
        className="absolute right-2 top-2 z-20 border"
        style={floatingToggleStyle}
        aria-label={
          inChat
            ? t({
                id: "officeAddin.startView.openStart",
                message: "Switch to start view",
              })
            : t({
                id: "officeAddin.startView.openChat",
                message: "Switch to chat",
              })
        }
        data-testid="addin-start-view-toggle"
      />
      {inChat ? (
        children
      ) : (
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          data-testid="addin-start-view"
        >
          <StartView
            platform={platform}
            openChat={openChat}
            acquireToken={acquireToken}
          />
        </div>
      )}
    </div>
  );
}
