/**
 * The row behaviours any `ChatHistoryList` override has to keep, authored by
 * the host so that a kit which has never heard of a rule still goes red the
 * day it drops one. Both sides run the same cases against their own list.
 *
 * Deliberately framework-free: the caller supplies rendering and menu opening,
 * because a kit's trailing menu mounts on hover while the host's does not, and
 * the shared surface must not carry a test runner. It reports failures rather
 * than asserting, so each side ends with one `expect(failures).toEqual([])`.
 *
 * Assertions read ids, test ids and relations — never label text: a kit's test
 * harness activates its own catalog, so host copy is unreadable there.
 */
/* eslint-disable lingui/no-unlocalized-strings -- failure text for a test run, never shown to a user */
import { createElement } from "react";

import { CHAT_HISTORY_ROW_MENU_ID } from "@/components/ui/Chat/chatHistoryRowMenuIds";
import { DELEGATION_PROVENANCE_KIND } from "@/utils/chat/recentChatSession";

import type { ChatHistoryListProps } from "@/components/ui/Chat/ChatHistoryList";
import type { DropdownMenuItem } from "@/components/ui/Controls/DropdownMenu";
import type { ChatSession } from "@/types/chat";
import type { ComponentType, ReactElement } from "react";

export interface ChatHistoryConformanceHarness {
  /** Renders the element inside whatever providers this side needs. */
  render: (element: ReactElement) => {
    container: HTMLElement;
    unmount: () => void;
  };
  /** Reveals the row's dropdown and returns the items it was handed. */
  openRowMenu: (container: HTMLElement) => DropdownMenuItem[];
}

const noop = () => {};

const ACTIVE_SESSION: ChatSession = {
  id: "conformance-chat",
  title: "A listed chat",
  messages: [],
  updatedAt: new Date("2024-01-01T00:00:00.000Z").toISOString(),
  metadata: { fileCount: 0 },
};

const ARCHIVED_SESSION: ChatSession = {
  ...ACTIVE_SESSION,
  archivedAt: new Date("2024-01-02T00:00:00.000Z").toISOString(),
};

/**
 * A run with a terminal outcome and no store behind it: its status dot and its
 * origin line both come from the session alone, which is what lets this run
 * outside the host app.
 */
const RUN_SESSION: ChatSession = {
  ...ACTIVE_SESSION,
  provenanceKind: DELEGATION_PROVENANCE_KIND,
  originChatId: "conformance-origin",
  originChatTitle: "The dispatching chat",
  delegatedRunOutcome: "failed",
};

const listProps = (
  session: ChatSession,
  overrides: Partial<ChatHistoryListProps> = {},
): ChatHistoryListProps => ({
  sessions: [session],
  currentSessionId: null,
  onSessionSelect: noop,
  onSessionArchive: noop,
  onSessionUnarchive: noop,
  onSessionEditTitle: noop,
  onSessionShare: noop,
  onSessionPin: noop,
  ...overrides,
});

const row = (container: HTMLElement) =>
  container.querySelector("[data-chat-id]");

const rowLabel = (container: HTMLElement) =>
  row(container)?.closest("[aria-label]")?.getAttribute("aria-label") ?? "";

const text = (container: HTMLElement, testId: string) =>
  container.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ??
  null;

const menuIds = (items: DropdownMenuItem[]) =>
  items.map((item) => item.id ?? "<no id>").join(", ");

const disabledById = (items: DropdownMenuItem[], id: string) =>
  items.find((item) => item.id === id)?.disabled ?? false;

interface ConformanceCase {
  name: string;
  props: ChatHistoryListProps;
  check: (container: HTMLElement, items: DropdownMenuItem[]) => string[];
}

const expectedIds = (
  items: DropdownMenuItem[],
  expected: readonly string[],
): string[] =>
  menuIds(items) === expected.join(", ")
    ? []
    : [`menu items are [${menuIds(items)}], expected [${expected.join(", ")}]`];

const CASES: ConformanceCase[] = [
  {
    name: "an active row",
    props: listProps(ACTIVE_SESSION),
    check: (container, items) => [
      ...(text(container, "chat-history-item-archived") === null
        ? []
        : ["an unarchived row renders the archived pill"]),
      ...(text(container, "chat-history-item-run-origin") === null
        ? []
        : ["an ordinary chat renders a delegated-run origin"]),
      ...expectedIds(items, [
        CHAT_HISTORY_ROW_MENU_ID.pin,
        CHAT_HISTORY_ROW_MENU_ID.share,
        CHAT_HISTORY_ROW_MENU_ID.rename,
        CHAT_HISTORY_ROW_MENU_ID.archive,
      ]),
    ],
  },
  {
    name: "an archived row",
    props: listProps(ARCHIVED_SESSION),
    check: (container, items) => {
      const pill = text(container, "chat-history-item-archived");
      return [
        ...(pill === null ? ["no archived pill on an archived row"] : []),
        ...(pill !== null && !rowLabel(container).includes(pill)
          ? ["the accessible name omits the archived marker"]
          : []),
        ...expectedIds(items, [
          CHAT_HISTORY_ROW_MENU_ID.rename,
          CHAT_HISTORY_ROW_MENU_ID.unarchive,
        ]),
      ];
    },
  },
  {
    name: "a delegated run",
    props: listProps(RUN_SESSION),
    check: (container, items) => {
      const origin = text(container, "chat-history-item-run-origin");
      return [
        ...(origin ? [] : ["no origin line on a delegated run"]),
        ...(origin && !rowLabel(container).includes(origin)
          ? ["the accessible name omits where the run came from"]
          : []),
        ...(container.querySelector('[data-testid="chat-generation-status"]')
          ? []
          : ["no status dot for a run with a recorded outcome"]),
        ...expectedIds(items, [
          CHAT_HISTORY_ROW_MENU_ID.pin,
          CHAT_HISTORY_ROW_MENU_ID.share,
          CHAT_HISTORY_ROW_MENU_ID.rename,
        ]),
      ];
    },
  },
  {
    name: "a row at the pin limit",
    props: listProps(ACTIVE_SESSION, {
      pinnedChatsCount: 3,
      pinnedChatsLimit: 3,
    }),
    check: (_container, items) =>
      disabledById(items, CHAT_HISTORY_ROW_MENU_ID.pin)
        ? []
        : ["pinning stays enabled at the pin limit"],
  },
  {
    name: "a row without edit rights",
    props: listProps({ ...ACTIVE_SESSION, canEdit: false }),
    check: (_container, items) => [
      ...expectedIds(items, [
        CHAT_HISTORY_ROW_MENU_ID.pin,
        CHAT_HISTORY_ROW_MENU_ID.share,
        CHAT_HISTORY_ROW_MENU_ID.rename,
        CHAT_HISTORY_ROW_MENU_ID.archive,
      ]),
      ...[
        CHAT_HISTORY_ROW_MENU_ID.pin,
        CHAT_HISTORY_ROW_MENU_ID.share,
        CHAT_HISTORY_ROW_MENU_ID.rename,
      ]
        .filter((id) => !disabledById(items, id))
        .map((id) => `"${id}" stays enabled without edit rights`),
    ],
  },
  {
    // Omission has to drop the item, not render it inert: a dead entry is
    // worse than a missing one and no type check can see it.
    name: "a row whose caller forwards no handlers",
    props: {
      sessions: [ACTIVE_SESSION],
      currentSessionId: null,
      onSessionSelect: noop,
    },
    check: (_container, items) => expectedIds(items, []),
  },
];

export const chatHistoryListConformanceFailures = (
  List: ComponentType<ChatHistoryListProps>,
  harness: ChatHistoryConformanceHarness,
): string[] => {
  const failures: string[] = [];

  for (const conformanceCase of CASES) {
    const { container, unmount } = harness.render(
      createElement(List, conformanceCase.props),
    );
    try {
      if (!row(container)) {
        failures.push(`${conformanceCase.name}: renders no row at all`);
        continue;
      }
      for (const failure of conformanceCase.check(
        container,
        harness.openRowMenu(container),
      )) {
        failures.push(`${conformanceCase.name}: ${failure}`);
      }
    } finally {
      unmount();
    }
  }

  return failures;
};
