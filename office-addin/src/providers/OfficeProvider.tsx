import { t } from "@lingui/core/macro";
import { createContext, useContext, useEffect, useState } from "react";

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
}

const OfficeContext = createContext<OfficeContextValue>({
  isReady: false,
  host: null,
  platform: null,
  mailboxUser: null,
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

          setContext({ isReady: true, host, platform, mailboxUser });
        });
      })
      .catch(() => {
        setContext({
          isReady: true,
          host: null,
          platform: null,
          mailboxUser: null,
        });
      });
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
