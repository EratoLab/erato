import {
  InteractionRequiredAuthError,
  createNestablePublicClientApplication,
  type AccountInfo,
  type IPublicClientApplication,
} from "@azure/msal-browser";
import { env, setIdToken } from "@erato/frontend/library";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { useOffice } from "./OfficeProvider";

interface MsalNaaContextValue {
  isInitialized: boolean;
  isAuthenticated: boolean;
  account: AccountInfo | null;
  acquireToken: (scopes: string[]) => Promise<string>;
  error: string | null;
}

const MsalNaaContext = createContext<MsalNaaContextValue>({
  isInitialized: false,
  isAuthenticated: false,
  account: null,
  acquireToken: () => Promise.reject(new Error("MsalNaaProvider not mounted")),
  error: null,
});

export function useMsalNaa() {
  return useContext(MsalNaaContext);
}

export function MsalNaaProvider({ children }: { children: React.ReactNode }) {
  const { mailboxUser } = useOffice();
  const [pca, setPca] = useState<IPublicClientApplication | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [loginHint, setLoginHint] = useState<string | undefined>();

  useEffect(() => {
    const clientId = import.meta.env.VITE_MSAL_CLIENT_ID ?? env().msalClientId;
    if (!clientId) {
      setError("MSAL client ID is not configured");
      setIsInitialized(true);
      return;
    }

    let naaSupported = false;
    try {
      if (typeof Office !== "undefined" && Office.context?.requirements) {
        naaSupported = Office.context.requirements.isSetSupported(
          "NestedAppAuth",
          "1.1",
        );
      }
    } catch {
      // Office not available outside add-in host.
    }

    if (!naaSupported) {
      setError(
        "Nested App Authentication is not supported in this environment",
      );
      setIsInitialized(true);
      return;
    }

    const authority =
      import.meta.env.VITE_MSAL_AUTHORITY ??
      env().msalAuthority ??
      "https://login.microsoftonline.com/common";

    const msalConfig = {
      auth: {
        clientId,
        authority,
        supportsNestedAppAuth: true,
      },
      cache: {
        cacheLocation: "localStorage" as const,
      },
    };

    async function resolveLoginHint(): Promise<string | undefined> {
      try {
        if (typeof Office !== "undefined" && Office.auth?.getAuthContext) {
          const authContext = await Office.auth.getAuthContext();
          if (authContext?.userPrincipalName) {
            return authContext.userPrincipalName;
          }
        }
      } catch {
        // Fallback below.
      }

      return mailboxUser?.emailAddress;
    }

    createNestablePublicClientApplication(msalConfig)
      .then(async (instance) => {
        setPca(instance);

        const hint = await resolveLoginHint();
        setLoginHint(hint);

        try {
          const result = await instance.acquireTokenSilent({
            scopes: ["User.Read"],
            ...(hint ? { loginHint: hint } : {}),
          });
          setAccount(result.account);
          setIdToken(result.idToken);
        } catch (silentError) {
          if (!(silentError instanceof InteractionRequiredAuthError)) {
            console.warn("MSAL silent auth error", silentError);
          }
        } finally {
          setIsInitialized(true);
        }
      })
      .catch((initializationError) => {
        console.error("MSAL initialization failed", initializationError);
        setError(
          initializationError instanceof Error
            ? initializationError.message
            : "Failed to initialize MSAL",
        );
        setIsInitialized(true);
      });
  }, [mailboxUser]);

  const acquireToken = useCallback(
    async (scopes: string[]): Promise<string> => {
      if (!pca) {
        throw new Error("MSAL not initialized");
      }

      try {
        const result = await pca.acquireTokenSilent({
          scopes,
          ...(loginHint ? { loginHint } : {}),
        });
        setAccount(result.account);
        setIdToken(result.idToken);
        return result.accessToken;
      } catch (silentError) {
        if (silentError instanceof InteractionRequiredAuthError) {
          const result = await pca.acquireTokenPopup({
            scopes,
            prompt: "select_account",
          });
          if (result.account) {
            pca.setActiveAccount(result.account);
          }
          setAccount(result.account);
          setIdToken(result.idToken);
          return result.accessToken;
        }

        throw silentError;
      }
    },
    [loginHint, pca],
  );

  return (
    <MsalNaaContext.Provider
      value={{
        isInitialized,
        isAuthenticated: account !== null,
        account,
        acquireToken,
        error,
      }}
    >
      {children}
    </MsalNaaContext.Provider>
  );
}
