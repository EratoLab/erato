import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";

import {
  ApprovalReferent,
  ApprovalTechnicalDetails,
} from "@/components/ui/Message/ApprovalReferent";
import { ToolUseStep } from "@/components/ui/Trace/steps/ToolUseStep";
import { approvalDisplayOf } from "@/lib/toolCallGist/approvalCard";
import { allowOnceEmphasisOf, toolMarksOf } from "@/lib/toolCallGist/decision";
import {
  toolDenyLabel,
  toolFactsLine,
  toolQuestion,
} from "@/lib/toolCallGist/decisionLabels";
import { toolCallCardOf } from "@/lib/toolCallGist/gist";
import {
  GIST_SLOTS,
  GIST_TITLE_SLOT,
  GIST_WHERE_SLOT,
  gistAskLineSlots,
  gistPlainLine,
  toolCallSentence,
} from "@/lib/toolCallGist/gistLabels";

import { renderTree } from "./hostTree";
import { setNumberLanguage } from "./polyfills";
import { toAdaptiveElements } from "./toAdaptiveCard";

import type { AcElement } from "./toAdaptiveCard";
import type { ToolUse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { AllowOnceEmphasis } from "@/lib/toolCallGist/decision";
import type { ToolCallCard } from "@/lib/toolCallGist/gist";
import type { Messages } from "@lingui/core";
import type { ReactNode } from "react";

/** The languages the cards are written in; anything else reads in English. */
export const CARD_LOCALES = ["en", "de", "fr", "es", "pl"] as const;

export const loadCatalogs = (catalogs: Record<string, Messages>) => {
  i18n.load(catalogs);
};

const activateLocale = (locale: unknown): string => {
  const language =
    typeof locale === "string" ? locale.toLowerCase().split(/[-_]/)[0] : "en";
  const chosen = (CARD_LOCALES as readonly string[]).includes(language)
    ? language
    : "en";
  i18n.activate(chosen);
  setNumberLanguage(chosen);
  return chosen;
};

const elementsOf = (
  element: ReactNode,
  locale: string,
  idPrefix: string,
  openAll: boolean,
): { elements: AcElement[]; errors: string[] } => {
  const tree = renderTree(element, openAll);
  return {
    elements: toAdaptiveElements(tree, { locale, idPrefix }),
    errors: tree.errors.map(errorText),
  };
};

const errorText = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

export interface ApprovalItemRequest {
  locale?: string;
  toolName: string;
  display?: unknown;
  input?: unknown;
  serverId?: string;
  idPrefix?: string;
}

export interface ApprovalItemCard {
  /** `legacy`: no label, so the surface keeps the card it had before labels. */
  kind: "gist" | "generic" | "legacy";
  /** The card's headline as one plain line, for notices and the decided card. */
  summary: string;
  referent: AcElement[];
  question: string;
  facts?: string;
  emphasis: AllowOnceEmphasis;
  /** The "Technical details" toggle and its body, which a full card may leave out. */
  details: AcElement[];
  allowOnce: string;
  deny: string;
  locale: string;
  /** What failed while rendering, for the surface's logs. */
  errors: string[];
}

/** The headline the web's referent shows, as plain text. */
const summaryOf = (
  card: ToolCallCard,
  title: string,
  server: string,
): string => {
  if (card.kind === "legacy") return title;
  if (card.kind === "gist") {
    return card.gist.items.length > 0
      ? gistPlainLine(card.gist, card.gist.items[0], "ask")
      : title;
  }
  return toolCallSentence(server.length > 0, card.change?.batch?.total)
    .split(GIST_SLOTS)
    .map((part) =>
      part === GIST_TITLE_SLOT
        ? title
        : part === GIST_WHERE_SLOT
          ? server
          : part,
    )
    .join("");
};

/**
 * One MCP approval as the web's approval item shows it: the referent, the
 * question with the facts line, and the technical details.
 */
export const approvalItem = (
  request: ApprovalItemRequest,
): ApprovalItemCard => {
  const locale = activateLocale(request.locale);
  const serverId = request.serverId ?? "";
  const display = approvalDisplayOf(request.display, request.toolName);
  const card = toolCallCardOf(display?.label, request.input, gistAskLineSlots);
  const idPrefix = request.idPrefix ?? "";
  const props = {
    toolName: request.toolName,
    display: request.display as never,
    input: request.input,
    serverId,
    isClientTool: false,
  };
  const referent = elementsOf(
    <ApprovalReferent {...props} />,
    locale,
    `${idPrefix}a`,
    true,
  );
  const details = elementsOf(
    <ApprovalTechnicalDetails {...props} />,
    locale,
    `${idPrefix}d`,
    true,
  );
  const closedWorld =
    typeof request.display === "object" &&
    request.display !== null &&
    (request.display as Record<string, unknown>).closed_world === true;
  const server = display?.server_name ?? serverId;
  return {
    kind: referent.errors.length > 0 ? "legacy" : card.kind,
    summary: summaryOf(card, display?.title ?? request.toolName, server),
    referent: referent.elements,
    question: toolQuestion(server),
    facts: toolFactsLine({
      ...toolMarksOf(card),
      locked: false,
      openWorld: !closedWorld,
    }),
    emphasis: allowOnceEmphasisOf(card),
    // As on the web, a part of the details that failed is left out and the
    // rest, the raw input among it, still shows.
    details: details.elements,
    allowOnce: t({ id: "actionConfirmation.allowOnce", message: "Allow once" }),
    deny: toolDenyLabel(),
    locale,
    errors: [...referent.errors, ...details.errors],
  };
};

export interface ResultRowRequest {
  locale?: string;
  part: ToolUse;
  idPrefix?: string;
}

export interface ResultRow {
  elements: AcElement[];
  locale: string;
  errors: string[];
}

/** A finished call as the web's trace row shows it: its line, details and link. */
export const resultRow = (request: ResultRowRequest): ResultRow => {
  const locale = activateLocale(request.locale);
  const part = { ...request.part, content_type: "tool_use" as const };
  const status = part.status === "error" ? "error" : "done";
  const row = elementsOf(
    <ToolUseStep
      part={part}
      status={status}
      isStreaming={false}
      isCollapsed
      isLastStep
    />,
    locale,
    request.idPrefix ?? "r",
    // Opens the row's own disclosures, such as a long failure message; the
    // row's title toggle names no region, so its raw input stays out.
    true,
  );
  return {
    elements: row.errors.length > 0 ? [] : row.elements,
    locale,
    errors: row.errors,
  };
};
