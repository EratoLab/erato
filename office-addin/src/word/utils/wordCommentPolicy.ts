import {
  WORD_COMMENT_ASSISTANT_AUTHOR_MAX,
  WORD_COMMENT_DEFAULT_ASSISTANT_AUTHOR,
  WORD_COMMENT_DEFAULT_LABEL,
  WORD_COMMENT_DEFAULT_ROW_CAPS,
} from "@erato/frontend/word-review";

import { wordApplyHost } from "./wordApplyPolicy";
import { wordHostPlatform } from "./wordHostPlatform";

import type { WordHostPlatform } from "./wordHostPlatform";
import type {
  WordCommentActionClass,
  WordCommentAuthorMode,
} from "@erato/frontend/word-review";

/**
 * Where comment actions write (contract §12, O-15): the strictest of the probe default per host,
 * the deployment's switch, and a switch this pane session sets on the first host error that says
 * Word will not do it here.
 */

export type WordCommentWriteMode = "post" | "copy";

export interface WordCommentHostDefaults {
  classes: Readonly<Record<WordCommentActionClass, WordCommentWriteMode>>;
  /** O-28 re-attribution: PC and Mac passed P-AUTH-1; the web lost inserts in 1 of 3 runs. */
  assistantAuthor: boolean;
}

const POST_ALL = { add: "post", respond: "post", modify: "post" } as const;

/** ERMAIN-947 defaults; an unknown host was never probed. */
export const WORD_COMMENT_HOST_DEFAULTS: Readonly<
  Record<WordHostPlatform, WordCommentHostDefaults>
> = {
  PC: { classes: POST_ALL, assistantAuthor: true },
  Mac: { classes: POST_ALL, assistantAuthor: true },
  OfficeOnline: { classes: POST_ALL, assistantAuthor: false },
  unknown: {
    classes: { add: "copy", respond: "copy", modify: "copy" },
    assistantAuthor: false,
  },
};

const CLASSES: readonly WordCommentActionClass[] = ["add", "respond", "modify"];

/** Office error codes that mean Word will not do this here, whatever is asked next. */
const SESSION_SWITCH_CODES: ReadonlySet<string> = new Set([
  "NotAllowed",
  "NotImplemented",
  "ApiNotFound",
  "AccessDenied",
]);

export type WordCommentSessionReason =
  | "NotAllowed"
  | "NotImplemented"
  | "ApiNotFound"
  | "AccessDenied";

const sessionSwitches = new Map<
  WordCommentActionClass,
  WordCommentSessionReason
>();
let sessionAssistantAuthorOff = false;

export function wordCommentErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Notes a host error from a comment write; returns true when it moved a class to copy. Read-only
 * protection refuses every class, so AccessDenied moves them all.
 */
export function noteWordCommentHostError(
  actionClass: WordCommentActionClass,
  error: unknown,
): boolean {
  const code = wordCommentErrorCode(error);
  if (!code || !SESSION_SWITCH_CODES.has(code)) return false;
  const reason = code as WordCommentSessionReason;
  for (const target of code === "AccessDenied" ? CLASSES : [actionClass])
    if (!sessionSwitches.has(target)) sessionSwitches.set(target, reason);
  return true;
}

/** Comments-only protection (GeneralException) or a failed re-attribution: user mode from now on. */
export function noteWordCommentAssistantAuthorOff(): void {
  sessionAssistantAuthorOff = true;
}

/** Tests and a pane reload. */
export function resetWordCommentSession(): void {
  sessionSwitches.clear();
  sessionAssistantAuthorOff = false;
}

export function wordCommentSessionReason(
  actionClass: WordCommentActionClass,
): WordCommentSessionReason | null {
  return sessionSwitches.get(actionClass) ?? null;
}

const deploymentWrites = () =>
  typeof window === "undefined"
    ? undefined
    : window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS?.comment_writes;

export function wordCommentWriteMode(
  actionClass: WordCommentActionClass,
  platform: WordHostPlatform = wordHostPlatform(),
): WordCommentWriteMode {
  if (WORD_COMMENT_HOST_DEFAULTS[platform].classes[actionClass] === "copy")
    return "copy";
  if (deploymentWrites()?.[actionClass] === "copy") return "copy";
  return sessionSwitches.has(actionClass) ? "copy" : "post";
}

/** Whether new comments may be re-attributed to the AI author on this host right now. */
export function wordCommentAssistantAuthorAvailable(
  platform: WordHostPlatform = wordHostPlatform(),
): boolean {
  return (
    WORD_COMMENT_HOST_DEFAULTS[platform].assistantAuthor &&
    deploymentWrites()?.assistant_author !== false &&
    !sessionAssistantAuthorOff &&
    wordCommentWriteMode("add", platform) === "post"
  );
}

export function wordCommentRowCap(actionClass: WordCommentActionClass): number {
  const configured = deploymentWrites()?.max_rows?.[actionClass];
  const fallback = WORD_COMMENT_DEFAULT_ROW_CAPS[actionClass];
  return Number.isSafeInteger(configured) &&
    (configured as number) >= 1 &&
    (configured as number) <= WORD_COMMENT_DEFAULT_ROW_CAPS.add
    ? (configured as number)
    : fallback;
}

export interface WordCommentDeploymentSettings {
  /** May be empty (O-8); an empty label blocks Always for adds. */
  label: string;
  authorSeed: WordCommentAuthorMode;
  authorEnforced: boolean;
  /** With {user} exactly once. */
  assistantAuthor: string;
}

const settings = () =>
  typeof window === "undefined"
    ? undefined
    : window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS;

export function wordCommentDeploymentSettings(): WordCommentDeploymentSettings {
  const configured = settings();
  const label = configured?.comment_label;
  const template = configured?.comment_assistant_author;
  return {
    label:
      typeof label === "string" ? label.trim() : WORD_COMMENT_DEFAULT_LABEL,
    authorSeed:
      configured?.comment_author === "assistant" ? "assistant" : "user",
    authorEnforced: configured?.comment_author_enforced === true,
    assistantAuthor:
      typeof template === "string" && template.split("{user}").length === 2
        ? template
        : WORD_COMMENT_DEFAULT_ASSISTANT_AUTHOR,
  };
}

/**
 * The name Word shows for an AI-authored comment; null when the principal has no usable name. The
 * name goes in as text, and a name too long for 120 characters is shortened with "…".
 */
export function wordCommentAssistantAuthorName(
  template: string,
  principalName: string | null | undefined,
): string | null {
  const name = principalName?.replace(/\s+/g, " ").trim();
  const parts = template.split("{user}");
  if (!name || parts.length !== 2) return null;
  const [before, after] = parts;
  const room =
    WORD_COMMENT_ASSISTANT_AUTHOR_MAX -
    Array.from(before).length -
    Array.from(after).length;
  if (room < 2) return null;
  const chars = Array.from(name);
  const fitted =
    chars.length <= room
      ? name
      : `${chars
          .slice(0, room - 1)
          .join("")
          .trimEnd()}…`;
  return `${before}${fitted}${after}`;
}

/** For the receipt: the host family, never a build or a document name. */
export const wordCommentHostKey = (
  platform: WordHostPlatform = wordHostPlatform(),
) => (platform === "unknown" ? "unknown" : wordApplyHost(platform));

// Device-local on purpose: Office.context.document.settings would persist into the .docx.
export const WORD_PREFERENCES_KEY = "erato.addin.word.preferences.v1";

export const isWordCommentAuthorMode = (
  value: unknown,
): value is WordCommentAuthorMode => value === "user" || value === "assistant";

/** The deployment's lock wins, then the user's stored choice, then the deployment's seed. */
export function wordCommentAuthorOf(
  stored: WordCommentAuthorMode | undefined,
): WordCommentAuthorMode {
  const { authorSeed, authorEnforced } = wordCommentDeploymentSettings();
  return authorEnforced ? authorSeed : (stored ?? authorSeed);
}

/** The stored "Post new comments as" choice, read outside React for the comment submission. */
export function wordCommentAuthorPreference(): WordCommentAuthorMode {
  let stored: unknown;
  try {
    const raw = globalThis.localStorage?.getItem(WORD_PREFERENCES_KEY);
    stored = raw
      ? (JSON.parse(raw) as { commentAuthor?: unknown })?.commentAuthor
      : undefined;
  } catch {
    stored = undefined;
  }
  return wordCommentAuthorOf(
    isWordCommentAuthorMode(stored) ? stored : undefined,
  );
}
