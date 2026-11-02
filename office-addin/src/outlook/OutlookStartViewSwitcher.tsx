import {
  Button,
  ChatBubbleIcon,
  MailIcon,
  componentRegistry,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { OutlookChatAccess } from "./OutlookChatAccess";
import { dismissSessionToasts } from "./components/sessionAskToast";
import { holdSessionPolicy, releaseSessionPolicy } from "./sessionPolicy";
import { useGraphTokenOptional } from "../core/auth/GraphTokenProvider";

import type {
  AddinChatAccess,
  AddinStartViewProps,
} from "@erato/frontend/library";
import type { ReactNode } from "react";

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
  return (
    <OutlookChatAccess platform={platform}>
      {(chatAccess, retryChatAccess) => (
        <StartViewSwitcher
          platform={platform}
          chatAccess={chatAccess}
          retryChatAccess={retryChatAccess}
        >
          {children}
        </StartViewSwitcher>
      )}
    </OutlookChatAccess>
  );
}

function StartViewSwitcher({
  platform,
  children,
  chatAccess,
  retryChatAccess,
}: {
  platform: string;
  children: ReactNode;
  chatAccess: AddinChatAccess;
  retryChatAccess?: () => void;
}) {
  const StartView = componentRegistry.AddinStartView;
  const graph = useGraphTokenOptional();
  const [view, setView] = useState<"start" | "chat">("start");
  const chatAllowed = chatAccess.status === "allowed";
  const chatAllowedRef = useRef(chatAllowed);
  chatAllowedRef.current = chatAllowed;
  const inChat = chatAllowed && (!StartView || view === "chat");

  const openChat = useCallback(() => {
    if (chatAllowedRef.current) setView("chat");
  }, []);

  // Rendering is gated synchronously above. Clear the remembered selection as
  // well, so a later grant does not unexpectedly reopen a previously open chat.
  useEffect(() => {
    if (!chatAllowed) setView("start");
  }, [chatAllowed]);

  // While the start view is shown, mail-item switches must not surface a
  // session ask toast on top of it (toasts float at z-1000). Same counted
  // gate the history drawer uses: hold defers the anchor policy, releasing
  // re-evaluates the latest state exactly once.
  const startViewActive = !inChat;
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

  const accessErrorMessage = t({
    id: "officeAddin.chatAccess.error",
    message: "Chat access could not be verified.",
  });
  const retryAction = retryChatAccess ? (
    <Button variant="secondary" className="mt-2" onClick={retryChatAccess}>
      {t({ id: "officeAddin.chatAccess.retry", message: "Try Again" })}
    </Button>
  ) : null;

  if (!StartView && inChat) {
    return <>{children}</>;
  }

  if (!StartView) {
    return (
      <div className="office-shell office-shell--centered" role="status">
        <p className="office-status">
          {chatAccess.status === "loading"
            ? t({
                id: "officeAddin.chatAccess.loading",
                message: "Checking chat access...",
              })
            : chatAccess.status === "denied"
              ? t({
                  id: "officeAddin.chatAccess.denied",
                  message: "Chat is not available for your account.",
                })
              : accessErrorMessage}
        </p>
        {retryAction}
      </div>
    );
  }

  return (
    <div className="relative flex size-full min-w-0 flex-col">
      {retryAction && (
        <div role="alert" className="p-3">
          <p>{accessErrorMessage}</p>
          {retryAction}
        </div>
      )}
      {/* A view switcher, not a disclosure — no aria-expanded, and the glyph
          swaps rather than flips — so it borrows the skin, not SidebarToggle. */}
      {chatAllowed && (
        <Button
          variant="sidebar-icon"
          icon={inChat ? <MailIcon /> : <ChatBubbleIcon />}
          onClick={() => (inChat ? setView("start") : openChat())}
          className="absolute right-2 top-2 z-20 floating-control-skin border"
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
      )}
      {inChat ? (
        children
      ) : (
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          data-testid="addin-start-view"
        >
          <StartView
            platform={platform}
            chatAccess={chatAccess}
            openChat={openChat}
            acquireToken={acquireToken}
          />
        </div>
      )}
    </div>
  );
}
