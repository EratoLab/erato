import { t } from "@lingui/core/macro";
import { createContext, useContext, useEffect, useRef, useState } from "react";

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
  /**
   * Whether this Office host can capture microphone audio. False on the
   * WebKit-based Mac desktop client and on mobile, where mic capture is
   * blocked regardless of permissions. See {@link isAudioCaptureSupportedPlatform}.
   */
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
  /**
   * The measured width of the task pane iframe, in CSS pixels. Null before
   * the first measurement fires. Updated whenever the pane is resized by the
   * host — including the user-resizable pane feature shipped in new Outlook in
   * mid-2026 (office-js #5337).
   *
   * Background: until mid-2026 the pane width was fixed by the host and not
   * user-adjustable. Microsoft shipped a resize handle for new Outlook
   * (web + Windows) around June 2026. On the Mac runtime the same period saw
   * several related instability bugs (office-js #6848: pinned pane loses
   * mailbox.item; office-js #6798: cold-start surfacing failure). The add-in
   * cannot programmatically control pane width in Outlook — TaskPaneApi 1.1
   * (Office.extensionLifeCycle.taskpane.setWidth) is only supported in Excel
   * and Word, not Outlook. The CSS layout fills whatever size the host
   * provides via the standard flex/100%-height pattern, which is the correct
   * approach. This field is exposed purely for diagnostic and adaptive-layout
   * use by consumers.
   */
  paneWidth: number | null;
}

const OfficeContext = createContext<OfficeContextValue>({
  isReady: false,
  host: null,
  platform: null,
  mailboxUser: null,
  supportsAudioCapture: false,
  itemTrackingRequiresPin: false,
  paneWidth: null,
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

/**
 * Platforms where Outlook blocks microphone capture entirely:
 * - `Mac`: the desktop client runs in a WebKit (WKWebView) host; the Device
 *   Permission API "isn't supported in Safari" and getUserMedia is blocked.
 * - `iOS` / `Android`: mobile add-ins can't capture audio.
 *
 * `PC` (classic Outlook desktop — the host shows a native prompt automatically)
 * and `OfficeOnline` (Outlook on the web AND new Outlook on Windows, both
 * Chromium) are supported. Values come from `Office.PlatformType`.
 */
const AUDIO_CAPTURE_BLOCKED_PLATFORMS = new Set(["Mac", "iOS", "Android"]);

/**
 * Reliable, synchronous probe for whether the current Office host can capture
 * microphone audio, based on `Office.onReady().platform`. Returns false for an
 * unknown/missing platform so audio is only surfaced where we know it works.
 *
 * Note: we deliberately do NOT probe `navigator.mediaDevices.enumerateDevices()`
 * — on new Outlook on Windows it reports zero microphones until the Device
 * Permission API grants access, which would wrongly flag a supported host as
 * unsupported.
 */
export function isAudioCaptureSupportedPlatform(
  platform: string | null,
): boolean {
  if (!platform) {
    return false;
  }
  return !AUDIO_CAPTURE_BLOCKED_PLATFORMS.has(platform);
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
    paneWidth: null,
  });

  useEffect(() => {
    void loadOfficeJs()
      .then(() => {
        return Office.onReady().then((info) => {
          const host = info.host ? String(info.host) : null;
          const platform = info.platform ? String(info.platform) : null;

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

          setContext((prev) => ({
            ...prev,
            isReady: true,
            host,
            platform,
            mailboxUser,
            supportsAudioCapture: isAudioCaptureSupportedPlatform(platform),
            itemTrackingRequiresPin:
              platform === "Mac" && !detectExchangeOnPrem(),
          }));
        });
      })
      .catch(() => {
        setContext((prev) => ({
          ...prev,
          isReady: true,
          host: null,
          platform: null,
          mailboxUser: null,
          supportsAudioCapture: false,
          itemTrackingRequiresPin: false,
        }));
      });
  }, []);

  // Track the pane width via ResizeObserver on the document root. This
  // surfaces unexpected resizes caused by the host — in particular the
  // user-resizable task pane feature that shipped in new Outlook (mid-2026,
  // office-js #5337) and the Mac-runtime bugs that coincide with it
  // (office-js #6798, #6848). The add-in has no Office API to control pane
  // width in Outlook (TaskPaneApi 1.1 / Office.extensionLifeCycle.taskpane
  // .setWidth is Excel/Word-only), so this is diagnostic-only: consumers can
  // react to narrow-pane conditions in their layouts.
  const paneWidthRef = useRef<number | null>(null);
  useEffect(() => {
    const target = document.documentElement;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.round(entry.contentRect.width);
        if (width !== paneWidthRef.current) {
          paneWidthRef.current = width;
          setContext((prev) => ({ ...prev, paneWidth: width }));
        }
      }
    });

    observer.observe(target);
    return () => {
      observer.disconnect();
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
