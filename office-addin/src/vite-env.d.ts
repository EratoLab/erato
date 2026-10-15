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
}

interface OfficeAddinWordApplyHostSettings {
  in_place?: boolean;
  /** Defaults: "allowed" on Word PC and Mac, "off" on Word for the web. */
  whole_document_import?: "allowed" | "confirm" | "off";
  package_read?: boolean;
}

interface OfficeAddinCommentWriteSettings {
  /** "copy" offers Copy comment and Show passage instead of writing. */
  add?: "post" | "copy";
  respond?: "post" | "copy";
  modify?: "post" | "copy";
  /** False posts every new comment under the user's name with the label. */
  assistant_author?: boolean;
  max_rows?: { add?: number; respond?: number; modify?: number };
}

interface OfficeAddinDefaultSettings {
  mode?: "resume" | "ask" | "new";
  compose_inherits_from_read?: boolean;
  word_include_document?: boolean;
  /** Deployment switches per Word host; see wordApplyPolicy. */
  word_apply?: {
    pc?: OfficeAddinWordApplyHostSettings;
    mac?: OfficeAddinWordApplyHostSettings;
    web?: OfficeAddinWordApplyHostSettings;
  };
  comment_label?: string;
  comment_author?: "user" | "assistant";
  comment_author_enforced?: boolean;
  comment_assistant_author?: string;
  /** Deployment switches for comment actions; see wordCommentPolicy. */
  comment_writes?: OfficeAddinCommentWriteSettings;
}

interface Window {
  MS_OFFICE_ADDIN_DEFAULT_SETTINGS?: OfficeAddinDefaultSettings;
  /** Kill switch: every Word document plan uses the full-document import. */
  WORD_FORCE_IMPORT_APPLY?: boolean;
  /** Development and native probes: write in place on every host, whatever the deployment says. */
  WORD_IN_PLACE_APPLY?: boolean;
  /** Development and native probes: read every paragraph ID as missing, as perpetual Office does. */
  WORD_FORCE_NO_PARAGRAPH_IDS?: boolean;
}
