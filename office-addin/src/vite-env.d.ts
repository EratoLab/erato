/// <reference types="vite/client" />
/// <reference types="office-js" />

declare module "*.po" {
  import type { Messages } from "@lingui/core";

  export const messages: Messages;
}

interface ImportMetaEnv {
  readonly VITE_MSAL_CLIENT_ID?: string;
  readonly VITE_MSAL_AUTHORITY?: string;
  readonly VITE_ASSISTANTS_ENABLED?: string;
  readonly VITE_ASSISTANTS_DELEGATION_ENABLED?: string;
  readonly VITE_ASSISTANTS_DELEGATION_ALLOW_BACKGROUND?: string;
  readonly VITE_DELEGATION_TASKS_ENABLED?: string;
  readonly VITE_DELEGATION_TASKS_ALLOW_ASYNC?: string;
  readonly VITE_DELEGATION_TASKS_APPROVAL_MODE?: string;
  readonly VITE_WORD_FORCE_IMPORT_APPLY?: string;
  readonly VITE_WORD_IN_PLACE_APPLY?: string;
}

interface OfficeAddinDefaultSettings {
  mode?: "resume" | "ask" | "new";
  compose_inherits_from_read?: boolean;
}

interface Window {
  MS_OFFICE_ADDIN_DEFAULT_SETTINGS?: OfficeAddinDefaultSettings;
  /** Kill switch: every Word document plan uses the full-document import. */
  WORD_FORCE_IMPORT_APPLY?: boolean;
}
