import { t } from "@lingui/core/macro";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import {
  MESSAGE_EXPLAIN_MAX_SELECTED_TEXT_CHARS,
  useMessageExplainStore,
} from "@/hooks/chat/store/messageExplainStore";
import {
  useOptionalFeatureConfig,
  type MessageTextActionsFeatureConfig,
} from "@/providers/FeatureConfigProvider";
import { formatMarkdownQuote } from "@/utils/chat/markdownQuote";

import { useChatInputControls } from "../Chat/ChatInputControlsContext";
import { AnchoredPopover } from "../Controls/AnchoredPopover";
import { Button } from "../Controls/Button";
import { PopoverChrome } from "../Controls/PopoverPanel";
import {
  resolveMessageTextSelection,
  type MessageTextSelection,
} from "../Message/messageTextBlocks";
import { ChatBubbleQuestionIcon, QuoteIcon } from "../icons";

import type { ChatMessage } from "./MessageList";

/** A keyboard selection (Shift + arrows) counts as made once it rests this long. */
const KEYBOARD_SETTLE_MS = 250;
/** After pointer-up the browser may still collapse a clicked selection. */
const POINTER_SETTLE_MS = 50;
const TOOLBAR_GAP_PX = 8;

export interface MessageTextActionsToolbarProps {
  /** The scrolling message list; text marked outside it gets no toolbar. */
  containerRef: RefObject<HTMLElement | null>;
  messages: Record<string, ChatMessage>;
  messageOrder: string[];
}

const isStreaming = (message: ChatMessage | undefined) =>
  !!message?.loading && message.loading.state !== "done";

const prefersCoarsePointer = () =>
  // eslint-disable-next-line lingui/no-unlocalized-strings -- media query
  window.matchMedia("(pointer: coarse)").matches;

const isEditable = (element: Element | null) =>
  element instanceof HTMLElement &&
  (element.isContentEditable ||
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA");

/**
 * The toolbar on marked message text. Mounted once per message list, and
 * driven by the DOM alone (`data-message-id` on the message root, the markers
 * `MessageContent` renders), so it works for every message layout a component
 * kit supplies as long as that layout renders the host's `MessageContent`.
 */
export function MessageTextActionsToolbar(
  props: MessageTextActionsToolbarProps,
) {
  const feature = useOptionalFeatureConfig()?.messageTextActions;
  if (!feature || (!feature.quoteEnabled && !feature.explainEnabled)) {
    return null;
  }
  return <EnabledMessageTextActionsToolbar {...props} feature={feature} />;
}

function EnabledMessageTextActionsToolbar({
  containerRef,
  messages,
  messageOrder,
  feature,
}: MessageTextActionsToolbarProps & {
  feature: MessageTextActionsFeatureConfig;
}) {
  const controls = useChatInputControls();
  const [marked, setMarked] = useState<MessageTextSelection | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const focusBeforeToolbarRef = useRef<HTMLElement | null>(null);

  const read = useCallback(() => {
    const container = containerRef.current;
    setMarked(
      container
        ? resolveMessageTextSelection(document.getSelection(), container)
        : null,
    );
  }, [containerRef]);

  useEffect(() => {
    let pointerIsDown = false;
    let timer: number | undefined;
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(read, delay);
    };
    const insideToolbar = (target: EventTarget | null) =>
      target instanceof Node && !!panelRef.current?.contains(target);

    const onPointerDown = (event: PointerEvent) => {
      pointerIsDown = !insideToolbar(event.target);
    };
    const onPointerUp = () => {
      if (pointerIsDown) {
        pointerIsDown = false;
        schedule(POINTER_SETTLE_MS);
      }
    };
    const onSelectionChange = () => {
      // While the pointer is down the selection is still being dragged.
      if (!pointerIsDown) {
        schedule(KEYBOARD_SETTLE_MS);
      }
    };
    const hide = (event: Event) => {
      if (!insideToolbar(event.target)) {
        window.clearTimeout(timer);
        setMarked(null);
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerUp, true);
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerUp, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [read]);

  // The small chat belongs to a finished message of this list. It goes when
  // that message is edited away, regenerated or streaming again, and when the
  // list shows another chat or unmounts.
  const explainedMessageId = useMessageExplainStore(
    (state) => state.card?.messageId ?? null,
  );
  const closeExplain = useMessageExplainStore((state) => state.close);
  const ownsExplainRef = useRef(false);
  useEffect(() => {
    if (explainedMessageId === null) {
      ownsExplainRef.current = false;
      return;
    }
    const isListed = messageOrder.includes(explainedMessageId);
    const isFinished = isListed && !isStreaming(messages[explainedMessageId]);
    if (isFinished) {
      ownsExplainRef.current = true;
    } else if (ownsExplainRef.current) {
      ownsExplainRef.current = false;
      closeExplain();
    }
  }, [closeExplain, explainedMessageId, messageOrder, messages]);
  useEffect(
    () => () => {
      if (ownsExplainRef.current) {
        closeExplain();
      }
    },
    [closeExplain],
  );

  const message = marked ? messages[marked.messageId] : undefined;
  const isFinishedMessage =
    !!marked &&
    !!message &&
    messageOrder.includes(marked.messageId) &&
    !isStreaming(message);
  const canQuote =
    isFinishedMessage &&
    feature.quoteEnabled &&
    typeof controls.appendToDraft === "function";
  const canExplain =
    isFinishedMessage && feature.explainEnabled && message.role === "assistant";
  const isOpen = canQuote || canExplain;

  const restoreFocus = useCallback(() => {
    const previous = focusBeforeToolbarRef.current;
    focusBeforeToolbarRef.current = null;
    if (previous?.isConnected) {
      previous.focus();
    } else if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const buttons = Array.from(
        panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      );
      const focused = document.activeElement;
      const isInside = panel.contains(focused);
      if (event.key === "Tab") {
        if (isInside) {
          event.preventDefault();
          restoreFocus();
        } else if (!event.shiftKey && !isEditable(focused) && buttons[0]) {
          // The panel is portalled to the end of the document, so Tab would
          // not reach it from the marked text on its own.
          event.preventDefault();
          focusBeforeToolbarRef.current =
            focused instanceof HTMLElement && focused !== document.body
              ? focused
              : null;
          buttons[0].focus();
        }
        return;
      }
      if (
        isInside &&
        (event.key === "ArrowRight" || event.key === "ArrowLeft")
      ) {
        event.preventDefault();
        const step = event.key === "ArrowRight" ? 1 : -1;
        const index = buttons.indexOf(focused as HTMLButtonElement);
        buttons[(index + step + buttons.length) % buttons.length]?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen, restoreFocus]);

  const close = useCallback(() => {
    if (panelRef.current?.contains(document.activeElement)) {
      restoreFocus();
    }
    setMarked(null);
  }, [restoreFocus]);

  const releaseSelection = () => {
    document.getSelection()?.removeAllRanges();
    focusBeforeToolbarRef.current = null;
    setMarked(null);
  };

  if (!isOpen) {
    return null;
  }

  const tooLongToExplain =
    marked.text.length > MESSAGE_EXPLAIN_MAX_SELECTED_TEXT_CHARS;

  return (
    <AnchoredPopover
      isOpen
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
      anchorRect={marked.rect}
      anchorGap={TOOLBAR_GAP_PX}
      panelRef={panelRef}
      width="content"
      widthFloor={false}
      manageFocus={false}
      role="toolbar"
      ariaLabel={t({
        id: "messageTextActions.toolbarLabel",
        message: "Actions on marked text",
      })}
      dataUi="message-text-actions"
      preferredOrientation={{
        // Below on touch devices, clear of the system's own selection menu.
        vertical: prefersCoarsePointer() ? "bottom" : "top",
        horizontal: "center",
      }}
    >
      <PopoverChrome
        column={false}
        scroll={false}
        className="flex items-center"
        // A press on the toolbar must neither clear the marked text nor move
        // focus out of where the user was.
        onMouseDown={(event) => event.preventDefault()}
      >
        {canQuote && (
          <Button
            variant="ghost"
            size="sm"
            icon={<QuoteIcon className="size-4" />}
            onClick={() => {
              controls.appendToDraft?.(
                formatMarkdownQuote(
                  marked.text,
                  marked.code
                    ? { code: true, codeLanguage: marked.code.language }
                    : undefined,
                ),
              );
              releaseSelection();
            }}
          >
            {t({ id: "messageTextActions.quote", message: "Quote" })}
          </Button>
        )}
        {canExplain && (
          <Button
            variant="ghost"
            size="sm"
            icon={<ChatBubbleQuestionIcon className="size-4" />}
            disabled={tooLongToExplain}
            title={
              tooLongToExplain
                ? t({
                    id: "messageTextActions.explain.tooLong",
                    message: "Mark a shorter passage to have it explained",
                  })
                : undefined
            }
            onClick={() => {
              useMessageExplainStore.getState().open({
                messageId: marked.messageId,
                passage: marked.text,
                anchor: marked.anchor,
              });
              releaseSelection();
            }}
          >
            {t({ id: "messageTextActions.explain.title", message: "Explain" })}
          </Button>
        )}
      </PopoverChrome>
    </AnchoredPopover>
  );
}
