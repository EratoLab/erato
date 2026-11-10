import { useMemo } from "react";
import { create } from "zustand";

import type { OperationRequest } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Which review each tool call waits on, kept beyond the page that opened it:
 * a review goes on while no page is open, so the next page finds the decision
 * under the job's handle instead of starting a new review, and the chat can
 * show the window again. Handles and ids only, per Origin and browser profile;
 * this says nothing about what the review shows.
 */
export type SidecarReviewLink = { at: number } & (
  | {
      state: "open";
      handle: string;
      /** The chats that wait for this review: the call's and the one it runs for. */
      chatIds?: string[];
    }
  // The job ended without a decision, so the call waits for the user to ask
  // again, and the same chats wait with it. A task's call ends with its
  // review, so once that call has its answer the link names no chats.
  | { state: "ended"; chatIds?: string[] }
  // The user asked again; the call's next run starts a new review.
  | { state: "asking" }
);

type Links = Readonly<Record<string, SidecarReviewLink>>;

const STORAGE_KEY = "erato.desktopSidecar.reviewLinks.v1";
/**
 * A link outlives its job so a call that still waits can say its review
 * ended: a parked call can wait for a day (`attempt_expiry_secs`).
 */
const KEEP_MS = 25 * 60 * 60 * 1000;

const isLink = (value: unknown): value is SidecarReviewLink => {
  if (typeof value !== "object" || value === null) return false;
  const { at, state, handle, chatIds } = value as Record<string, unknown>;
  const ids = chatIds === undefined || Array.isArray(chatIds);
  return (
    typeof at === "number" &&
    (state === "asking" ||
      (state === "ended" && ids) ||
      (state === "open" && typeof handle === "string" && ids))
  );
};

/** The chats that wait while `link`'s call waits on the user. */
const waitingChatIds = (link: SidecarReviewLink | undefined): string[] =>
  link?.state === "open" || link?.state === "ended" ? (link.chatIds ?? []) : [];

const fresh = (links: Links): Links =>
  Object.fromEntries(
    Object.entries(links).filter(([, link]) => Date.now() - link.at < KEEP_MS),
  );

/** What storage holds, or `null` where it cannot be read. */
const stored = (): Links | null => {
  try {
    const parsed: unknown = JSON.parse(
      globalThis.localStorage.getItem(STORAGE_KEY) ?? "{}",
    );
    if (typeof parsed !== "object" || parsed === null) return {};
    return fresh(
      Object.fromEntries(
        Object.entries(parsed).filter(([, link]) => isLink(link)),
      ),
    );
  } catch {
    return null;
  }
};

export const useSidecarReviewLinks = create<{ links: Links }>(() => ({
  links: stored() ?? {},
}));

function write(change: (links: Links) => Links): void {
  // Another tab may have written since this one last read.
  const links = fresh(
    change(stored() ?? useSidecarReviewLinks.getState().links),
  );
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(links));
  } catch {
    // Without storage the link lasts as long as this page.
  }
  useSidecarReviewLinks.setState({ links });
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", ({ key }) => {
    if (key === STORAGE_KEY || key === null)
      useSidecarReviewLinks.setState({
        links: stored() ?? useSidecarReviewLinks.getState().links,
      });
  });
}

/** Tool call ids are the model provider's, so the message scopes them. */
export const reviewLinkKey = (messageId: string, toolCallId: string): string =>
  `${messageId}:${toolCallId}`;

export const reviewLink = (key: string): SidecarReviewLink | undefined =>
  useSidecarReviewLinks.getState().links[key];

const set = (key: string, link: SidecarReviewLink) =>
  write((links) => ({ ...links, [key]: link }));

export const rememberReview = (
  key: string,
  handle: string,
  chatIds?: string[],
): void =>
  set(key, {
    state: "open",
    handle,
    at: Date.now(),
    ...(chatIds?.length ? { chatIds } : {}),
  });

/** The chats the review named keep waiting, now for the user to ask again. */
export const markReviewEnded = (key: string): void =>
  write((links) => {
    const chatIds = waitingChatIds(links[key]);
    return {
      ...links,
      [key]: {
        state: "ended",
        at: Date.now(),
        ...(chatIds.length ? { chatIds } : {}),
      },
    };
  });

/**
 * A task's review ended without a decision. Its call ends with it, so no chat
 * waits on the user for it any more; the link stays, naming no chats, so the
 * item of the response the task runs for can say the review ended.
 */
export const markTaskReviewEnded = (key: string): void =>
  set(key, { state: "ended", at: Date.now() });

export const askForReviewAgain = (key: string): void =>
  set(key, { state: "asking", at: Date.now() });

export const forgetReview = (key: string): void => {
  if (reviewLink(key)) write(({ [key]: _gone, ...links }) => links);
};

/**
 * Every chat that waits on the user for a review, in this browser: one open
 * in the Erato desktop app, or one that ended and waits for Ask again. A link
 * outlives its call, so this says nothing about a chat that is not parked.
 */
const chatsInReview = (links: Links): ReadonlySet<string> =>
  new Set(Object.values(links).flatMap(waitingChatIds));

/** The chats a review of this browser waits on, across its tabs. */
export const useChatsInReview = (): ReadonlySet<string> => {
  const links = useSidecarReviewLinks((state) => state.links);
  return useMemo(() => chatsInReview(links), [links]);
};

/** Whether this call's review ended and it waits for the user to ask again. */
export const reviewHasEnded = (
  messageId: string,
  toolCallId: string,
): boolean =>
  reviewLink(reviewLinkKey(messageId, toolCallId))?.state === "ended";

/**
 * Whether a parked call waits for the user to ask again, so no run may claim
 * it. Only the user's own call does: a task's call ends with its review, so
 * its next run reports that instead of waiting.
 */
export const waitsToAskAgain = ({
  message_id,
  tool_call_id,
  lineage,
}: Pick<
  OperationRequest,
  "message_id" | "tool_call_id" | "lineage"
>): boolean => !lineage && reviewHasEnded(message_id, tool_call_id);
