/// <reference types="vite/client" />
/// <reference types="office-js" />

interface ImportMetaEnv {
  readonly VITE_MSAL_CLIENT_ID?: string;
  readonly VITE_MSAL_AUTHORITY?: string;
  readonly VITE_ASSISTANTS_ENABLED?: string;
  readonly VITE_ASSISTANTS_DELEGATION_ENABLED?: string;
  readonly VITE_ASSISTANTS_DELEGATION_ALLOW_BACKGROUND?: string;
}
