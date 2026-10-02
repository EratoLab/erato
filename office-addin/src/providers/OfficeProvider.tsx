import {
  installAudioCaptureAccessPolicy,
  toast,
  saveComposeReloadState,
  restoreComposeReloadState,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { createContext, useContext, useEffect, useState } from "react";

import {
  createOfficeAudioAccess,
  isOfficeAudioCaptureSupported,
} from "./officeAudioAccess";
import { activateHostLocale } from "../utils/activateHostLocale";
import { detectExchangeOnPrem } from "../utils/detectExchangeOnPrem";

interface MailboxUser {
  emailAddress: string;
  displayName: string;
  accountType: string;
}

interface OfficeContextValue {
  isReady: boolean;
  host: string | null;
  platform: string | null;
  mailboxUser: MailboxUser | null;
  /** Whether DevicePermissionService 1.1 is available in this Office host. */
  supportsAudioCapture: boolean;
  /**
   * True when the task pane only follows mail navigation while pinned AND a
   * pin control actually exists. New Outlook on Mac never delivers
   * `ItemChanged` to an unpinned pane (office-js #5575), so pinning is the
   * only tracking mechanism there — but the Exchange SE manifest declares no
   * `SupportsPinning` (a V1_1 block gated at Mailbox 1.5 would be needed), so
   * on-prem mailboxes have no pin to point at. Windows/OWA panes track
   * without pinning.
   */
  itemTrackingRequiresPin: boolean;
}

const OfficeContext = createContext<OfficeContextValue>({
  isReady: false,
  host: null,
  platform: null,
  mailboxUser: null,
  supportsAudioCapture: false,
  itemTrackingRequiresPin: false,
});

const OFFICE_JS_CDN =
  "https://appsforoffice.microsoft.com/lib/1/hosted/office.js";

let officeJsPromise: Promise<void> | null = null;

function loadOfficeJs(): Promise<void> {
  if (!officeJsPromise) {
    officeJsPromise = new Promise((resolve, reject) => {
      if (
        typeof Office !== "undefined" &&
        typeof Office.onReady === "function"
      ) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = OFFICE_JS_CDN;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Office.js"));
      document.head.appendChild(script);
    });
  }

  return officeJsPromise;
}

export function useOffice() {
  return useContext(OfficeContext);
}

export function OfficeProvider({ children }: { children: React.ReactNode }) {
  const [context, setContext] = useState<OfficeContextValue>({
    isReady: false,
    host: null,
    platform: null,
    mailboxUser: null,
    supportsAudioCapture: false,
    itemTrackingRequiresPin: false,
  });

  useEffect(() => {
    let disposed = false;
    let disposeAudioAccess: (() => void) | undefined;
    void loadOfficeJs()
      .then(() => {
        return Office.onReady().then(async (info) => {
          const host = info.host ? String(info.host) : null;
          const platform = info.platform ? String(info.platform) : null;

          // Children render in the host's language from their first paint.
          let displayLanguage: string | null = null;
          try {
            displayLanguage = Office.context.displayLanguage;
          } catch (error) {
            console.warn("Failed to read Office displayLanguage", error);
          }
          await activateHostLocale(displayLanguage);

          let mailboxUser: MailboxUser | null = null;
          if (host === "Outlook") {
            try {
              const profile = Office.context.mailbox.userProfile;
              mailboxUser = {
                emailAddress: profile.emailAddress,
                displayName: profile.displayName,
                accountType: profile.accountType,
              };
            } catch (error) {
              console.warn("Failed to read mailbox userProfile", error);
            }
          }

          if (disposed) return;
          const supportsAudioCapture = isOfficeAudioCaptureSupported();
          const draftKey = `erato.office.audioConsentDraft.${host}`;
          try {
            restoreComposeReloadState(window.sessionStorage, draftKey);
          } catch (error) {
            console.warn(
              "Failed to restore composer after microphone consent",
              error,
            );
          }
          disposeAudioAccess = installAudioCaptureAccessPolicy(
            createOfficeAudioAccess({
              host,
              supported: supportsAudioCapture,
              beforeReload: () => {
                try {
                  saveComposeReloadState(window.sessionStorage, draftKey);
                } catch (error) {
                  toast.error({
                    title:
                      error instanceof Error &&
                      error.name === "ComposeReloadBlockedError"
                        ? t({
                            id: "officeAddin.audio.pendingAttachments",
                            message:
                              "Microphone access needs a reload. Finish uploading and send or remove staged attachments, then try again.",
                          })
                        : t({
                            id: "officeAddin.audio.draftSaveFailed",
                            message:
                              "Your draft could not be saved for the microphone permission reload. Please send your draft and try again.",
                          }),
                  });
                  throw error;
                }
              },
            }),
          );
          setContext({
            isReady: true,
            host,
            platform,
            mailboxUser,
            supportsAudioCapture,
            itemTrackingRequiresPin:
              platform === "Mac" && !detectExchangeOnPrem(),
          });
        });
      })
      .catch(() => {
        if (disposed) return;
        disposeAudioAccess = installAudioCaptureAccessPolicy(
          createOfficeAudioAccess({
            host: null,
            supported: false,
            beforeReload: () => {},
          }),
        );
        setContext({
          isReady: true,
          host: null,
          platform: null,
          mailboxUser: null,
          supportsAudioCapture: false,
          itemTrackingRequiresPin: false,
        });
      });
    return () => {
      disposed = true;
      disposeAudioAccess?.();
    };
  }, []);

  if (!context.isReady) {
    return (
      <div className="office-shell office-shell--centered">
        <p className="office-status">
          {t({
            id: "officeAddin.office.loading",
            message: "Loading Office Add-in...",
          })}
        </p>
      </div>
    );
  }

  return (
    <OfficeContext.Provider value={context}>{children}</OfficeContext.Provider>
  );
}
