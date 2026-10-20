import { action } from "@storybook/addon-actions";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { ChatInput } from "@/components/ui/Chat/ChatInput";
import { useLiveAnnouncement } from "@/components/ui/Chat/ComposerContext/useLiveAnnouncement";
import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { ModalBase } from "@/components/ui/Modal/ModalBase";
import { wordShowInWordLabel } from "@/components/ui/WordReview/WordReviewCardParts";
import { OpenNewWindowIcon } from "@/components/ui/icons";

import { AnnouncementLog, stagedFile } from "./composerContextStoryKit";
import {
  WORD_COMMENT_STORIES,
  WORD_COMMENT_STORY_SIMULATIONS,
} from "./composerContextWordCommentScenarios";
import generated from "./composerContextWordComments.generated.json";
import { recordingFile } from "../helpers/audioRecordingFiles";

import type { WordCommentStoryName } from "./composerContextWordCommentScenarios";
import type { ChatInputControlsHandle } from "@/components/ui/Chat/ChatInputControlsContext";
import type {
  ComposerContextDetailRenderContext,
  ComposerContextItem,
  ComposerNotice,
} from "@/components/ui/Chat/ComposerContext/types";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

/*
 * The Word composer's chips and send prompts, drawn from what the add-in's own
 * resolvers wrote for each story and for every gesture one or two steps from
 * it (composerContextWordComments.generated.json, written by
 * office-addin/src/word/utils/__tests__/wordCommentStoryParity.test.ts).
 * Nothing here decides a state: a gesture the file does not reach is logged
 * as an action and changes nothing. The detail bodies stand in for the
 * add-in's WordCommentDetails and WordContextDetails with the same parts.
 */

interface Note {
  tone: "info" | "warning" | "error";
  text: string;
}

interface Coverage {
  heading: string;
  lines: string[];
  hint?: string;
}

type Body =
  | {
      kind: "selection";
      text: string;
      cut: boolean;
      paragraphs: string;
      notes: Note[];
      comments: {
        count: number;
        checked: boolean;
        threads: string[];
        why: string | null;
        coverage: Coverage | null;
        sendLabel: string;
      } | null;
      lifetime: string;
    }
  | {
      kind: "document";
      notes: Note[];
      coverage: Coverage | null;
      comments: string[];
      commentsNote?: string;
      lifetime: string;
    }
  | {
      kind: "comment";
      variant: "thread" | "choose" | "gone";
      why: string | null;
      thread: string | null;
      choices: string[];
      intro?: string;
      notes: Note[];
      coverage: Coverage | null;
      lifetime: string;
    }
  | {
      kind: "openComments";
      intro: string;
      notes: Note[];
      coverage: Coverage | null;
      lifetime?: string;
    };

type ItemData = Omit<
  ComposerContextItem,
  "onRemove" | "onRestore" | "detail" | "origin" | "dismissScope"
> & {
  origin: "ambient" | "user";
  dismissScope?: "message" | "selection" | "item" | "chat";
  remove: boolean;
  restore: boolean;
  detail: {
    title: string;
    actions: {
      id: string;
      label: string;
      variant?: "primary" | "secondary";
      announcement?: string;
    }[];
    body: Body;
  };
};

interface NoticeData {
  id: string;
  tone: ComposerNotice["tone"];
  text: string;
  busy?: boolean;
  progressLabel?: string;
  actions: { id: string; label: string }[];
  dismissible: boolean;
}

interface ThreadData {
  author: string;
  title: string;
  status: string;
  activity?: string;
  replies?: string;
  text: string;
  quote: string;
  chosen: string;
}

interface WordCommentStorySend {
  carrier: "selection" | "document" | "comment" | "open-comments" | "none";
  document: string;
  selection: string;
  comments: string;
  block?: string;
}

interface StoryData {
  strings: {
    choose: string;
    choices: string;
    passageHeading: string;
    passageHint: string;
    documentComments: string;
    selectedText: string;
    pickerTitle: string;
  };
  threads: Record<string, ThreadData>;
  stories: Record<string, { id: string; start: string; pickable: string[] }>;
  states: Record<
    string,
    { items: string[]; notice: NoticeData | null; send: WordCommentStorySend }
  >;
  items: Record<string, ItemData>;
  /** Gestures the file does not reach are missing. */
  transitions: Partial<
    Record<string, Partial<Record<string, { to: string; announce?: string }>>>
  >;
}

const DATA = generated as unknown as StoryData;

type Go = (gesture: string) => void;

const logGesture = action("gesture");
const logUnmodelled = action("gesture not in the generated file");

// Read with the detail when it opens; a live role would announce it again.
const DetailNote = ({ note }: { note: Note }) => (
  <div data-ui="word-context-detail-note" data-tone={note.tone}>
    <Alert role="none" type={note.tone}>
      {note.text}
    </Alert>
  </div>
);

const Lifetime = ({ text }: { text?: string }) =>
  text ? (
    <p
      className="text-xs text-theme-fg-secondary"
      data-ui="word-context-detail-lifetime"
    >
      {text}
    </p>
  ) : null;

const WhyTag = ({ text }: { text: string }) => (
  <span
    className="pill-geometry self-start border border-theme-border px-1.5 py-px text-xs font-medium text-theme-fg-primary"
    data-ui="word-comment-detail-why"
  >
    {text}
  </span>
);

const CoverageList = ({
  coverage,
  dataUi = "word-comment-what-is-sent",
}: {
  coverage: Coverage;
  dataUi?: string;
}) => {
  const headingId = useId();
  return (
    <section className="flex flex-col gap-1" data-ui={dataUi}>
      <h3
        id={headingId}
        className="text-xs font-semibold text-theme-fg-secondary"
      >
        {coverage.heading}
      </h3>
      <ul
        aria-labelledby={headingId}
        className="flex list-disc flex-col gap-1 pl-4 text-xs text-theme-fg-secondary"
      >
        {coverage.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
};

const ThreadFacts = ({ thread }: { thread: ThreadData }) => (
  <span className="flex flex-wrap items-center gap-x-2 text-xs text-theme-fg-secondary">
    <span className="font-medium text-theme-fg-primary">{thread.author}</span>
    {thread.activity && <span>{thread.activity}</span>}
    <span>{thread.status}</span>
    {thread.replies && <span>{thread.replies}</span>}
  </span>
);

const Section = ({
  title,
  dataUi,
  children,
}: {
  title: string;
  dataUi: string;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-1" data-ui={dataUi}>
    <h3 className="text-xs font-semibold text-theme-fg-secondary">{title}</h3>
    {children}
  </section>
);

function CommentBody({
  body,
  context,
  go,
  openPicker,
}: {
  body: Extract<Body, { kind: "comment" }>;
  context: ComposerContextDetailRenderContext;
  go: Go;
  openPicker: () => void;
}) {
  const thread = body.thread ? DATA.threads[body.thread] : null;
  return (
    <div
      className="flex flex-col gap-3"
      data-ui="word-comment-detail"
      data-variant={body.variant}
    >
      {thread && body.thread ? (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
          data-ui="word-comment-detail-quote"
        >
          {body.why && <WhyTag text={body.why} />}
          <span className="break-words text-theme-fg-secondary">
            {thread.quote}
          </span>
          <Button
            type="button"
            variant="link"
            icon={<OpenNewWindowIcon className="size-4 shrink-0" />}
            onClick={() => go(`show:${body.thread}`)}
          >
            {wordShowInWordLabel()}
          </Button>
        </div>
      ) : (
        body.why && <WhyTag text={body.why} />
      )}
      {body.intro && <p className="text-sm">{body.intro}</p>}
      {thread && (
        <div
          className="flex flex-col gap-1 rounded-[var(--theme-radius-control)] border border-theme-border bg-theme-bg-secondary px-3 py-2"
          data-ui="word-comment-detail-thread"
        >
          <ThreadFacts thread={thread} />
          <p className="whitespace-pre-wrap break-words text-sm text-theme-fg-primary">
            {thread.text}
          </p>
        </div>
      )}
      {body.choices.length > 0 && (
        <ul
          className="flex flex-col gap-2"
          aria-label={DATA.strings.choices}
          data-ui="word-comment-choices"
        >
          {body.choices.map((ref) => {
            const choice = DATA.threads[ref];
            return (
              <li key={ref}>
                <button
                  type="button"
                  className="flex w-full flex-col gap-1 rounded-[var(--theme-radius-control)] border border-theme-border bg-theme-bg-secondary px-3 py-2 text-left hover:bg-theme-bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus"
                  onClick={() =>
                    context.runAction({
                      id: `pick:${ref}`,
                      label: choice.title,
                      announcement: choice.chosen,
                      onSelect: () => go(`pick:${ref}`),
                    })
                  }
                >
                  <ThreadFacts thread={choice} />
                  <span className="line-clamp-2 text-sm text-theme-fg-primary">
                    {choice.text}
                  </span>
                  <span className="truncate text-xs text-theme-fg-secondary">
                    {choice.quote}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {body.variant === "choose" && (
        <div className="self-start">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() =>
              context.runAction({
                id: "choose",
                label: DATA.strings.choose,
                onSelect: openPicker,
              })
            }
          >
            {DATA.strings.choose}
          </Button>
        </div>
      )}
      {body.notes.map((note) => (
        <DetailNote key={note.text} note={note} />
      ))}
      {body.coverage && <CoverageList coverage={body.coverage} />}
      <Lifetime text={body.lifetime} />
    </div>
  );
}

function PassageComments({
  comments,
  locked,
  go,
}: {
  comments: NonNullable<Extract<Body, { kind: "selection" }>["comments"]>;
  locked: boolean;
  go: Go;
}) {
  const hintId = useId();
  const checkboxId = useId();
  return (
    <section
      className="flex flex-col gap-2"
      data-ui="word-context-detail-passage-comments"
    >
      <h3 className="text-xs font-semibold text-theme-fg-secondary">
        {DATA.strings.passageHeading}
      </h3>
      <ul className="flex flex-col gap-1 text-sm">
        {comments.threads.map((ref) => (
          <li key={ref} className="break-words">
            <span className="font-medium">{DATA.threads[ref].author}</span>
            {" · "}
            <span className="text-theme-fg-secondary">
              {DATA.threads[ref].text}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-start gap-2 text-sm">
        <input
          id={checkboxId}
          type="checkbox"
          checked={comments.checked}
          disabled={locked}
          aria-describedby={hintId}
          onChange={(event) =>
            go(`passage-comments:${event.target.checked ? "on" : "off"}`)
          }
          className="mt-0.5 size-4 shrink-0 accent-[var(--theme-fg-accent)]"
        />
        <div className="flex flex-col">
          <label htmlFor={checkboxId}>{comments.sendLabel}</label>
          <span id={hintId} className="text-xs text-theme-fg-secondary">
            {DATA.strings.passageHint}
          </span>
        </div>
      </div>
      {comments.why && <WhyTag text={comments.why} />}
      {comments.coverage && <CoverageList coverage={comments.coverage} />}
    </section>
  );
}

function DetailBody({
  body,
  context,
  go,
  openPicker,
}: {
  body: Body;
  context: ComposerContextDetailRenderContext;
  go: Go;
  openPicker: () => void;
}) {
  switch (body.kind) {
    case "comment":
      return (
        <CommentBody
          body={body}
          context={context}
          go={go}
          openPicker={openPicker}
        />
      );
    case "openComments":
      return (
        <div
          className="flex flex-col gap-3"
          data-ui="word-open-comments-detail"
        >
          <p className="text-sm">{body.intro}</p>
          {body.notes.map((note) => (
            <DetailNote key={note.text} note={note} />
          ))}
          {body.coverage && <CoverageList coverage={body.coverage} />}
          <Lifetime text={body.lifetime} />
        </div>
      );
    case "selection":
      return (
        <div className="flex flex-col gap-3">
          <blockquote
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll region must take focus to scroll by keyboard
            tabIndex={0}
            aria-label={DATA.strings.selectedText}
            data-ui="word-context-detail-quote"
            className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-r-[var(--theme-radius-control)] border-l-2 border-theme-border bg-theme-bg-secondary py-2 pl-3 pr-2 text-sm text-theme-fg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus"
          >
            {body.cut ? `${body.text}…` : body.text}
          </blockquote>
          <p className="text-xs text-theme-fg-secondary">{body.paragraphs}</p>
          {body.notes.map((note) => (
            <DetailNote key={note.text} note={note} />
          ))}
          {body.comments && (
            <PassageComments
              comments={body.comments}
              locked={context.locked}
              go={go}
            />
          )}
          <Lifetime text={body.lifetime} />
        </div>
      );
    case "document":
      return (
        <div className="flex flex-col gap-3">
          {body.notes.map((note) => (
            <DetailNote key={note.text} note={note} />
          ))}
          {body.coverage && (
            <Section
              title={body.coverage.heading}
              dataUi="word-context-detail-coverage"
            >
              {body.coverage.lines.slice(0, 1).map((line) => (
                <p key={line}>{line}</p>
              ))}
              {body.coverage.hint && (
                <p className="text-xs text-theme-fg-secondary">
                  {body.coverage.hint}
                </p>
              )}
              {body.coverage.lines.slice(1).map((line) => (
                <p key={line} className="text-xs text-theme-fg-secondary">
                  {line}
                </p>
              ))}
            </Section>
          )}
          {(body.comments.length > 0 || body.commentsNote) && (
            <Section
              title={DATA.strings.documentComments}
              dataUi="word-context-detail-comments"
            >
              {body.commentsNote ? (
                <p>{body.commentsNote}</p>
              ) : (
                <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-theme-fg-secondary">
                  {body.comments.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </Section>
          )}
          <Lifetime text={body.lifetime} />
        </div>
      );
  }
}

/** Opens the picker, or logs the settings it would open; neither changes what is sent. */
const UI_ACTIONS = new Set(["choose", "change-default", "retry"]);

function laneItem(
  data: ItemData,
  go: Go,
  openPicker: () => void,
): ComposerContextItem {
  const { remove, restore, detail, ...rest } = data;
  return {
    ...rest,
    ...(remove ? { onRemove: () => go(`x:${data.id}`) } : {}),
    ...(restore ? { onRestore: () => go(`+:${data.id}`) } : {}),
    detail: {
      title: detail.title,
      render: (context) => (
        <DetailBody
          body={detail.body}
          context={context}
          go={go}
          openPicker={openPicker}
        />
      ),
      ...(detail.actions.length > 0
        ? {
            actions: detail.actions.map((entry) => ({
              ...entry,
              onSelect: () =>
                entry.id === "choose"
                  ? openPicker()
                  : UI_ACTIONS.has(entry.id)
                    ? logGesture(`${data.id}: ${entry.label}`)
                    : go(`action:${data.id}:${entry.id}`),
            })),
          }
        : {}),
    },
  } as ComposerContextItem;
}

function composerNotice(
  data: NoticeData | null,
  go: Go,
  openPicker: () => void,
): ComposerNotice | null {
  if (!data) return null;
  return {
    id: data.id,
    tone: data.tone,
    text: data.text,
    ...(data.busy ? { busy: true } : {}),
    ...(data.progressLabel ? { progressLabel: data.progressLabel } : {}),
    ...(data.actions.length > 0
      ? {
          actions: data.actions.map((entry) => ({
            id: entry.id,
            label: entry.label,
            onSelect: () =>
              entry.id === "choose-comment"
                ? openPicker()
                : go(`notice:${entry.id}`),
          })),
        }
      : {}),
    ...(data.dismissible ? { onDismiss: () => go("notice:dismiss") } : {}),
  };
}

/** The add-in's picker, cut down to the threads this story's file reaches. */
function StoryPicker({
  refs,
  onPick,
  onClose,
}: {
  refs: string[];
  onPick: (ref: string) => void;
  onClose: () => void;
}) {
  return (
    <ModalBase isOpen onClose={onClose} title={DATA.strings.pickerTitle}>
      <ul className="flex flex-col gap-2" data-testid="word-story-picker">
        {refs.map((ref) => {
          const thread = DATA.threads[ref];
          return (
            <li key={ref}>
              <button
                type="button"
                className="flex w-full flex-col gap-1 rounded-[var(--theme-radius-control)] border border-theme-border bg-theme-bg-secondary px-3 py-2 text-left hover:bg-theme-bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus"
                onClick={() => onPick(ref)}
              >
                <ThreadFacts thread={thread} />
                <span className="text-sm text-theme-fg-primary">
                  {thread.text}
                </span>
                <span className="truncate text-xs text-theme-fg-secondary">
                  {thread.quote}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </ModalBase>
  );
}

const SEND_WORDS: Record<WordCommentStorySend["carrier"], string> = {
  selection: "the selected passage",
  document: "the document",
  comment: "one comment thread",
  "open-comments": "the open comments",
  none: "only your text",
};

const BUSY_FILES: FileUploadItem[] = [
  stagedFile("f1", "Pricing schedule.pdf"),
  stagedFile("f2", "Delivery terms.pdf"),
  stagedFile("f3", "Signed NDA.pdf"),
  stagedFile("f4", "Audit report 2025.pdf"),
  stagedFile("f5", "Insurance certificate.pdf"),
  recordingFile("rec", "transcribing"),
];

const LIVE_REGIONS = [
  '[data-ui="composer-context-live"]',
  '[data-testid="word-composer-announcer"]',
];

export function WordCommentStoryComposer({
  story: initial,
}: {
  story: WordCommentStoryName;
}) {
  const [story, setStory] = useState<WordCommentStoryName>(initial);
  const [stateKey, setStateKey] = useState(DATA.stories[initial].start);
  const stateKeyRef = useRef(stateKey);
  stateKeyRef.current = stateKey;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [announcement, announce] = useLiveAnnouncement();
  const seed = WORD_COMMENT_STORIES[initial];
  const interactive = "interactive" in seed && seed.interactive;
  const busy = "busyFiles" in seed && seed.busyFiles;
  // The add-in locks the composer itself (an archived chat), and the chips with it.
  const locked = "locked" in seed && seed.locked;

  const go = useCallback<Go>(
    (gesture) => {
      const next = DATA.transitions[stateKeyRef.current]?.[gesture];
      if (!next) {
        logUnmodelled(gesture);
        return;
      }
      logGesture(gesture);
      stateKeyRef.current = next.to;
      setStateKey(next.to);
      if (next.announce) announce(next.announce);
    },
    [announce],
  );
  const openPicker = useCallback(() => setPickerOpen(true), []);
  const composerRef = useRef<ChatInputControlsHandle>(null);
  // As WordChatInput does: a pick that answers a notice leaves no opener to return to.
  const pickerWasOpenRef = useRef(false);
  useEffect(() => {
    if (pickerOpen) {
      pickerWasOpenRef.current = true;
      return;
    }
    if (!pickerWasOpenRef.current) return;
    pickerWasOpenRef.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body)
      composerRef.current?.focusInput();
  }, [pickerOpen]);
  const state = DATA.states[stateKey];
  const items = useMemo(
    () =>
      DATA.states[stateKey].items.map((key) =>
        laneItem(DATA.items[key], go, openPicker),
      ),
    [stateKey, go, openPicker],
  );
  const notice = useMemo(
    () => composerNotice(DATA.states[stateKey].notice, go, openPicker),
    [stateKey, go, openPicker],
  );
  const jump = (target: WordCommentStoryName) => {
    setStory(target);
    stateKeyRef.current = DATA.stories[target].start;
    setStateKey(DATA.stories[target].start);
  };

  return (
    <>
      {pickerOpen && (
        <StoryPicker
          refs={DATA.stories[story].pickable}
          onClose={() => setPickerOpen(false)}
          onPick={(ref) => {
            setPickerOpen(false);
            go(`picker:${ref}`);
          }}
        />
      )}
      <div
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-testid="word-composer-announcer"
      >
        {announcement}
      </div>
      <ChatInput
        ref={composerRef}
        onSendMessage={() => go("send")}
        handleFileAttachments={action("handleFileAttachments")}
        initialFiles={busy ? BUSY_FILES : []}
        contextItems={items}
        composerNotice={notice}
        maxFiles={20}
        disabled={locked}
        showControls
      />
      <p
        data-testid="word-story-send"
        data-carrier={state.send.carrier}
        className="mt-3 text-xs text-theme-fg-secondary"
      >
        {state.send.block
          ? "Next Send waits on your choice."
          : `Next Send carries ${SEND_WORDS[state.send.carrier]}.`}
      </p>
      {interactive ? (
        <div
          role="group"
          aria-label="Simulate"
          className="mt-3 flex flex-wrap gap-2 text-xs"
        >
          {WORD_COMMENT_STORY_SIMULATIONS.map(({ label, story: target }) => (
            <button
              key={label}
              type="button"
              onClick={() => jump(target)}
              aria-pressed={story === target}
              className="border border-theme-border px-2 py-1 text-theme-fg-primary"
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <AnnouncementLog regions={LIVE_REGIONS} />
    </>
  );
}
