import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { Disclosure } from "@/components/ui/Controls/Disclosure";
import { Alert } from "@/components/ui/Feedback/Alert";
import {
  GistValueText,
  McpToolDescription,
  ToolArgumentView,
  ToolCallChangeBody,
  ToolCallChangeCard,
  ToolCallGist,
  ToolCallIdentity,
  ToolCallInput,
} from "@/components/ui/ToolCall";
import {
  approvalDisplayOf,
  useToolCallCard,
} from "@/lib/toolCallGist/approvalCard";
import { cardSourceOf } from "@/lib/toolCallGist/cardLayout";
import { SCROLL_BOX_CLASS, scrollBoxProps } from "@/lib/toolCallGist/scrollBox";

import { ComputerIcon, ResolvedIcon } from "../icons";
import { ApprovalToolHeading } from "./ApprovalToolHeading";

import type { ToolDisplayMetadata } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { CardSource } from "@/lib/toolCallGist/cardLayout";
import type { ToolCallCard, ToolCallCardNotes } from "@/lib/toolCallGist/gist";
import type { ReactNode } from "react";

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

const truncatedArgumentsLine = () =>
  t({
    id: "toolArguments.truncated",
    message:
      "Some arguments are not shown here. Technical details has all of them.",
  });

/** Where a value the card cannot show as written is a risk: hidden characters. */
const CardRisk = ({ notes }: { notes: ToolCallCardNotes }) =>
  notes.hiddenCharacters ? (
    <Alert type="warning" role="none" data-testid="tool-call-hidden-characters">
      {t({
        id: "toolGist.note.hiddenCharacters",
        message:
          "Some values in this call contain hidden characters, which are removed here. What the call writes may differ from what you see.",
      })}
    </Alert>
  ) : null;

/**
 * What the card leaves to Technical details, in the footnote: a consent flag
 * the call set itself, and arguments the label could not hold.
 */
const cardFootnoteLines = (
  notes: ToolCallCardNotes,
  truncated: boolean,
): ReactNode[] => [
  ...(notes.leavesOutConsent
    ? [
        <p key="consent" data-testid="tool-call-consent-left-out">
          {t({
            id: "toolGist.note.consentLeftOut",
            message:
              "The call set an approval value of its own, which is not shown. Only your decision on this card counts.",
          })}
        </p>,
      ]
    : []),
  ...(truncated
    ? [
        <p key="truncated" data-testid="tool-call-arguments-truncated">
          {truncatedArgumentsLine()}
        </p>,
      ]
    : []),
];

/** The same lines on a card without a footnote of its own. */
const CardFootnotes = ({
  notes,
  truncated = false,
}: {
  notes: ToolCallCardNotes;
  truncated?: boolean;
}) => {
  const lines = cardFootnoteLines(notes, truncated);
  return lines.length === 0 ? null : (
    <div className="space-y-0.5 text-xs text-theme-fg-muted">{lines}</div>
  );
};

/** The place and table the source line names after the server. */
const SourcePlace = ({ source }: { source: CardSource }) => (
  <>
    {source.where.map((value, index) => (
      <Fragment key={index}>
        {index > 0 ? ", " : " · "}
        <GistValueText value={value} showWritten wholeId />
      </Fragment>
    ))}
    {source.whereOmitted > 0 && ` +${source.whereOmitted}`}
    {source.table !== undefined && (
      <>
        {" · "}
        <span dir="auto" className="[unicode-bidi:isolate]">
          {source.table}
        </span>
      </>
    )}
  </>
);

/**
 * A source line's text that names a place, bounded: the place can be a long
 * ID written whole. It is a tab stop and a named group only once it scrolls.
 */
const BoundedSourceText = ({ children }: { children: ReactNode }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const check = () => {
      setOverflows(element.scrollHeight > element.clientHeight + 1);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [children]);
  return (
    <span
      ref={ref}
      {...(overflows ? scrollBoxProps("line") : {})}
      className={clsx(
        SCROLL_BOX_CLASS,
        "block max-h-24 min-w-0 break-words text-xs text-theme-fg-muted [overflow-wrap:anywhere]",
      )}
    >
      {children}
    </span>
  );
};

const ServerLine = ({
  display,
  serverId,
  isClientTool,
  source,
}: {
  display: ToolDisplayMetadata | null;
  serverId: string;
  isClientTool: boolean;
  source?: CardSource;
}) => (
  <div
    className="flex min-w-0 items-center gap-2"
    data-testid="approval-source-line"
  >
    {referentIcon(isClientTool)}
    {source ? (
      <BoundedSourceText>
        <span dir="auto" className="[unicode-bidi:isolate]">
          {referentSource(display, serverId, isClientTool)}
        </span>
        <SourcePlace source={source} />
      </BoundedSourceText>
    ) : (
      <span
        dir="auto"
        className="min-w-0 break-words text-xs text-theme-fg-muted [unicode-bidi:isolate]"
      >
        {referentSource(display, serverId, isClientTool)}
      </span>
    )}
  </div>
);

type ResolvedReferentProps = Omit<ApprovalReferentProps, "display"> & {
  display: ToolDisplayMetadata | null;
};

const ArgumentsScrollBox = ({ children }: { children: ReactNode }) => (
  <div
    {...scrollBoxProps("arguments")}
    className={clsx(SCROLL_BOX_CLASS, "max-h-48")}
  >
    {children}
  </div>
);

/** Today's referent: the tool heading, any `notes`, and the raw input. */
const RawReferent = ({
  toolName,
  display,
  input,
  serverId,
  isClientTool,
  titleClassName,
  className,
  notes,
}: ResolvedReferentProps & { notes?: ReactNode }) => (
  <>
    <ApprovalToolHeading
      className={className}
      toolName={toolName}
      display={display}
      icon={referentIcon(isClientTool)}
      source={referentSource(display, serverId, isClientTool)}
      titleClassName={titleClassName}
    />
    <div className="mt-2 space-y-2">
      {notes}
      <ArgumentsScrollBox>
        <ToolCallInput input={input} />
      </ArgumentsScrollBox>
    </div>
  </>
);

const LabelledReferent = (props: ResolvedReferentProps) => {
  const { display, input, serverId, isClientTool, className } = props;
  const card = useToolCallCard(display?.label, input);

  if (card.kind === "gist" && card.gist.change) {
    return (
      <div className={clsx("space-y-1", className)}>
        <ServerLine
          display={display}
          serverId={serverId}
          isClientTool={isClientTool}
          source={cardSourceOf(card.gist)}
        />
        <ToolCallChangeCard
          gist={card.gist}
          change={card.gist.change}
          phase="ask"
          notes={<CardRisk notes={card.notes} />}
          footnotes={cardFootnoteLines(card.notes, false)}
          toolTitle={display?.title ?? props.toolName}
          placeInSource
        />
      </div>
    );
  }

  if (card.kind === "gist") {
    const { rest } = card;
    return (
      <div className={clsx("space-y-1", className)}>
        <ServerLine
          display={display}
          serverId={serverId}
          isClientTool={isClientTool}
          source={cardSourceOf(card.gist)}
        />
        <ToolCallGist
          gist={card.gist}
          phase="ask"
          notes={
            <>
              <CardRisk notes={card.notes} />
              {(rest.kind === "raw" || rest.view) && (
                <p
                  className="text-xs text-theme-fg-muted"
                  data-testid="tool-call-other-arguments-note"
                >
                  {t({
                    id: "toolGist.note.otherArguments",
                    message:
                      "This call's other arguments are at the end of the list below.",
                  })}
                </p>
              )}
            </>
          }
          footnotes={cardFootnoteLines(
            card.notes,
            rest.kind === "view" && rest.truncated,
          )}
          placeInSource
        >
          {rest.kind === "raw" ? (
            <ArgumentsScrollBox>
              <ToolCallInput input={input} />
            </ArgumentsScrollBox>
          ) : (
            rest.view && (
              <div
                className="space-y-1"
                data-testid="tool-call-other-arguments"
              >
                <p className="text-xs text-theme-fg-muted">
                  {t({
                    id: "toolGist.otherArguments",
                    message: "Other arguments",
                  })}
                </p>
                <ArgumentsScrollBox>
                  <ToolArgumentView
                    view={rest.view}
                    values={rest.values}
                    compact
                    data-testid="tool-call-other-arguments-view"
                  />
                </ArgumentsScrollBox>
              </div>
            )
          )}
        </ToolCallGist>
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
        <div className="mt-2 space-y-2">
          <CardRisk notes={card.notes} />
          {card.change && (
            <ToolCallChangeBody change={card.change} values={false} />
          )}
          <ArgumentsScrollBox>
            <ToolArgumentView view={card.view} values={card.values} />
          </ArgumentsScrollBox>
          <CardFootnotes notes={card.notes} truncated={card.truncated} />
        </div>
      </>
    );
  }
  return (
    <RawReferent
      {...props}
      notes={
        card.kind === "generic" && (
          <>
            <CardRisk notes={card.notes} />
            {card.change && (
              <ToolCallChangeBody change={card.change} values={false} />
            )}
            <CardFootnotes notes={card.notes} />
          </>
        )
      }
    />
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
    () => approvalDisplayOf(props.display, props.toolName),
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
    () => approvalDisplayOf(props.display, props.toolName),
    [props.display, props.toolName],
  );
  return (
    <ErrorBoundary resetKeys={[props.display, props.input]} fallback={null}>
      <LabelledTechnicalDetails {...props} display={display} />
    </ErrorBoundary>
  );
};
