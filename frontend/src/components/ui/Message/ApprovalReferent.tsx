import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useMemo } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { Disclosure } from "@/components/ui/Controls/Disclosure";
import { Alert } from "@/components/ui/Feedback/Alert";
import {
  McpToolDescription,
  ToolArgumentView,
  ToolCallGist,
  ToolCallIdentity,
  ToolCallInput,
} from "@/components/ui/ToolCall";
import { toolCallCardOf } from "@/lib/toolCallGist/gist";
import { gistAskLineSlots } from "@/lib/toolCallGist/gistLabels";
import { isRecord } from "@/lib/toolCallGist/serverText";

import { ComputerIcon, ResolvedIcon } from "../icons";
import { ApprovalToolHeading } from "./ApprovalToolHeading";

import type {
  ToolCallLabel,
  ToolDisplayMetadata,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ToolCallCard, ToolCallCardNotes } from "@/lib/toolCallGist/gist";

interface ApprovalReferentProps {
  toolName: string;
  display?: ToolDisplayMetadata | null;
  input: unknown;
  /** The MCP server, or a client tool's namespace. */
  serverId: string;
  isClientTool: boolean;
  titleClassName?: string;
  className?: string;
}

/**
 * The descriptor as the cards render it: text fields only when they are
 * text, so a row from another writer cannot put an object into the page.
 */
const displayOf = (
  display: unknown,
  toolName: string,
): ToolDisplayMetadata | null => {
  if (!isRecord(display)) return null;
  const text = (value: unknown) =>
    typeof value === "string" ? value : undefined;
  return {
    title: text(display.title) ?? toolName,
    description: text(display.description),
    description_truncated: display.description_truncated === true,
    server_name: text(display.server_name),
    label: display.label as ToolCallLabel | undefined,
  };
};

const referentIcon = (isClientTool: boolean) =>
  isClientTool ? (
    <ComputerIcon className="size-4 shrink-0 text-theme-fg-secondary" />
  ) : (
    <ResolvedIcon
      iconId="simpleicons-modelcontextprotocol"
      className="size-4 shrink-0 text-theme-fg-secondary"
    />
  );

const referentSource = (
  display: ToolDisplayMetadata | null,
  serverId: string,
  isClientTool: boolean,
) =>
  isClientTool
    ? t({ id: "clientToolApproval.thisDevice", message: "This device" })
    : (display?.server_name ?? serverId);

/** A card that shows the raw arguments itself gets none behind its details. */
const showsRawInput = (card: ToolCallCard) =>
  card.kind === "legacy" ||
  (card.kind === "generic" && card.view === undefined) ||
  (card.kind === "gist" && card.rest.kind === "raw");

const TruncatedArgumentsNote = () => (
  <Alert type="info" role="none" className="mt-2">
    {t({
      id: "toolArguments.truncated",
      message:
        "Some arguments are not shown here. Technical details has all of them.",
    })}
  </Alert>
);

/**
 * What the card says about values it cannot show as the call wrote them:
 * removed hidden characters, and a consent flag the call set itself.
 */
const CardNotes = ({ notes }: { notes: ToolCallCardNotes }) => (
  <>
    {notes.hiddenCharacters && (
      <Alert
        type="warning"
        role="none"
        className="mt-2"
        data-testid="tool-call-hidden-characters"
      >
        {t({
          id: "toolGist.note.hiddenCharacters",
          message:
            "Some values in this call contain hidden characters, which are removed here. What the call writes may differ from what you see.",
        })}
      </Alert>
    )}
    {notes.leavesOutConsent && (
      <Alert
        type="info"
        role="none"
        className="mt-2"
        data-testid="tool-call-consent-left-out"
      >
        {t({
          id: "toolGist.note.consentLeftOut",
          message:
            "The call set an approval value of its own, which is not shown. Only your decision on this card counts.",
        })}
      </Alert>
    )}
  </>
);

type ResolvedReferentProps = Omit<ApprovalReferentProps, "display"> & {
  display: ToolDisplayMetadata | null;
};

/** Today's referent: the tool heading and the raw input. */
const RawReferent = ({
  toolName,
  display,
  input,
  serverId,
  isClientTool,
  titleClassName,
  className,
}: ResolvedReferentProps) => (
  <>
    <ApprovalToolHeading
      className={className}
      toolName={toolName}
      display={display}
      icon={referentIcon(isClientTool)}
      source={referentSource(display, serverId, isClientTool)}
      titleClassName={titleClassName}
    />
    <div className="mt-2 max-h-48 overflow-y-auto">
      <ToolCallInput input={input} />
    </div>
  </>
);

/** The card for a label, with the values its line names in the language shown. */
const useToolCallCard = (
  label: ToolCallLabel | undefined,
  input: unknown,
): ToolCallCard => {
  const locale = i18n.locale;
  return useMemo(
    () => toolCallCardOf(label, input, gistAskLineSlots),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the line's words, and so which values it names, follow the locale
    [label, input, locale],
  );
};

const LabelledReferent = (props: ResolvedReferentProps) => {
  const { display, input, serverId, isClientTool, className } = props;
  const card = useToolCallCard(display?.label, input);

  if (card.kind === "gist") {
    const { rest } = card;
    return (
      <div className={clsx("space-y-2", className)}>
        <div className="flex min-w-0 items-center gap-2">
          {referentIcon(isClientTool)}
          <span
            dir="auto"
            className="min-w-0 break-words text-xs text-theme-fg-muted [unicode-bidi:isolate]"
          >
            {referentSource(display, serverId, isClientTool)}
          </span>
        </div>
        <ToolCallGist gist={card.gist} phase="ask" />
        {rest.kind === "raw" ? (
          <div className="max-h-48 overflow-y-auto">
            <ToolCallInput input={input} />
          </div>
        ) : (
          rest.view && (
            <div className="space-y-1" data-testid="tool-call-other-arguments">
              <p className="text-xs text-theme-fg-muted">
                {t({
                  id: "toolGist.otherArguments",
                  message: "Other arguments",
                })}
              </p>
              <div className="max-h-48 overflow-y-auto">
                <ToolArgumentView
                  view={rest.view}
                  values={rest.values}
                  compact
                  data-testid="tool-call-other-arguments-view"
                />
              </div>
            </div>
          )
        )}
        {rest.kind === "view" && rest.truncated && <TruncatedArgumentsNote />}
        <CardNotes notes={card.notes} />
      </div>
    );
  }

  if (card.kind === "generic" && card.view) {
    return (
      <>
        <ApprovalToolHeading
          className={className}
          toolName={props.toolName}
          display={display}
          icon={referentIcon(isClientTool)}
          source={referentSource(display, serverId, isClientTool)}
          titleClassName={props.titleClassName}
        />
        <div className="mt-2 max-h-48 overflow-y-auto">
          <ToolArgumentView view={card.view} values={card.values} />
        </div>
        {card.truncated && <TruncatedArgumentsNote />}
        <CardNotes notes={card.notes} />
      </>
    );
  }
  return (
    <>
      <RawReferent {...props} />
      {card.kind === "generic" && <CardNotes notes={card.notes} />}
    </>
  );
};

/**
 * What an approval asks about, above its consent card. A call with a label
 * reads as its gist: one line on what it does to what, and where, with its
 * key values, and every argument the gist does not show listed below it. A
 * label without a gist shows the arguments as names and values. Requests
 * saved before labels, and any label this card fails to render, keep the
 * tool heading and the raw input, so the buttons below always stay usable.
 */
export const ApprovalReferent = (props: ApprovalReferentProps) => {
  const display = useMemo(
    () => displayOf(props.display, props.toolName),
    [props.display, props.toolName],
  );
  return (
    <ErrorBoundary
      resetKeys={[props.display, props.input]}
      fallback={
        <RawReferent
          {...props}
          display={display && { ...display, label: undefined }}
        />
      }
    >
      <LabelledReferent {...props} display={display} />
    </ErrorBoundary>
  );
};

const LabelledTechnicalDetails = ({
  toolName,
  display,
  input,
  serverId,
  isClientTool,
}: Omit<ResolvedReferentProps, "titleClassName" | "className">) => {
  const card = useToolCallCard(display?.label, input);
  if (!display || card.kind === "legacy") return null;
  const isGist = card.kind === "gist";
  return (
    <Disclosure
      className="mt-1"
      bodyClassName="space-y-2 pt-1"
      label={t({
        id: "toolCall.technicalDetails",
        message: "Technical details",
      })}
      data-testid="approval-technical-details"
    >
      <ToolCallIdentity
        toolName={toolName}
        server={
          isClientTool ? referentSource(display, serverId, true) : serverId
        }
      />
      {/* The generic card shows the descriptor in its heading already. */}
      {isGist && display.title !== toolName && (
        <p
          dir="auto"
          className="text-xs text-theme-fg-secondary [unicode-bidi:isolate]"
        >
          {display.title}
        </p>
      )}
      {isGist && display.description && (
        <McpToolDescription
          description={display.description}
          truncated={display.description_truncated}
        />
      )}
      {!showsRawInput(card) && <ToolCallInput input={input} />}
    </Disclosure>
  );
};

/**
 * The tool, its server and the raw arguments of a labelled call, one click
 * away below the consent card. Requests saved before labels show their raw
 * input already, so they get none, and nor does a card's raw input repeat.
 */
export const ApprovalTechnicalDetails = (
  props: Omit<ApprovalReferentProps, "titleClassName" | "className">,
) => {
  const display = useMemo(
    () => displayOf(props.display, props.toolName),
    [props.display, props.toolName],
  );
  return (
    <ErrorBoundary resetKeys={[props.display, props.input]} fallback={null}>
      <LabelledTechnicalDetails {...props} display={display} />
    </ErrorBoundary>
  );
};
