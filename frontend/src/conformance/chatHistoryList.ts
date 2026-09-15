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
  items.map((item) => item.id ?? "<no id>");

/**
 * One item the host's gates have to produce. Both flags default to `false`,
 * which is what an absent flag means on a `DropdownMenuItem`, so a case states
 * only what it turns on and an item that is wrongly disabled or wrongly silent
 * still fails.
 */
interface RequiredMenuItem {
  id: string;
  disabled?: boolean;
  confirmAction?: boolean;
}

interface ConformanceCase {
  name: string;
  props: ChatHistoryListProps;
  /** Ids that must be present, in the relative order they must keep. */
  menu: readonly RequiredMenuItem[];
  /** Ids the gates drop for this row, which must not come back. */
  menuMustNotContain: readonly string[];
  check?: (container: HTMLElement) => string[];
}

/**
 * A required subset in relative order, not the exact array: the stable ids
 * exist so a kit can add entries of its own and place them where it likes, and
 * a suite that goes red for that is a suite the kit stops running. A required
 * id missing, a pair out of order, a wrong gate, or an id the host drops for
 * this row rendered anyway all still fail — a visible inert action is worse
 * than a missing one.
 */
const menuFailures = (
  items: DropdownMenuItem[],
  { menu, menuMustNotContain }: ConformanceCase,
): string[] => {
  const ids = menuIds(items);
  const rendered = `the menu is [${ids.join(", ")}]`;
  const failures = menuMustNotContain
    .filter((id) => ids.includes(id))
    .map((id) => `"${id}" is rendered where the gates drop it; ${rendered}`);

  let cursor = -1;
  for (const { id, disabled = false, confirmAction = false } of menu) {
    const inOrder = ids.indexOf(id, cursor + 1);
    const anywhere = inOrder === -1 ? ids.indexOf(id) : inOrder;
    if (anywhere === -1) {
      failures.push(`"${id}" is missing; ${rendered}`);
      continue;
    }
    if (inOrder === -1) {
      failures.push(
        `"${id}" comes before an item it has to follow; ${rendered}`,
      );
    } else {
      cursor = inOrder;
    }

    const item = items[anywhere];
    if ((item.disabled ?? false) !== disabled) {
      failures.push(
        disabled
          ? `"${id}" stays enabled where the gate disables it`
          : `"${id}" is disabled where the gate leaves it enabled`,
      );
    }
    if ((item.confirmAction ?? false) !== confirmAction) {
      failures.push(
        confirmAction
          ? `"${id}" acts without asking first`
          : `"${id}" asks first where nothing is at stake`,
      );
    }
  }

  return failures;
};

const CASES: ConformanceCase[] = [
  {
    name: "an active row",
    props: listProps(ACTIVE_SESSION),
    menu: [
      { id: CHAT_HISTORY_ROW_MENU_ID.pin },
      { id: CHAT_HISTORY_ROW_MENU_ID.share },
      { id: CHAT_HISTORY_ROW_MENU_ID.rename },
      { id: CHAT_HISTORY_ROW_MENU_ID.archive },
    ],
    menuMustNotContain: [CHAT_HISTORY_ROW_MENU_ID.unarchive],
    check: (container) => [
      ...(text(container, "chat-history-item-archived") === null
        ? []
        : ["an unarchived row renders the archived pill"]),
      ...(text(container, "chat-history-item-run-origin") === null
        ? []
        : ["an ordinary chat renders a delegated-run origin"]),
    ],
  },
  {
    name: "an archived row",
    props: listProps(ARCHIVED_SESSION),
    menu: [
      { id: CHAT_HISTORY_ROW_MENU_ID.rename },
      { id: CHAT_HISTORY_ROW_MENU_ID.unarchive },
    ],
    menuMustNotContain: [
      CHAT_HISTORY_ROW_MENU_ID.pin,
      CHAT_HISTORY_ROW_MENU_ID.share,
      CHAT_HISTORY_ROW_MENU_ID.archive,
    ],
    check: (container) => {
      const pill = text(container, "chat-history-item-archived");
      return [
        ...(pill === null ? ["no archived pill on an archived row"] : []),
        ...(pill !== null && !rowLabel(container).includes(pill)
          ? ["the accessible name omits the archived marker"]
          : []),
      ];
    },
  },
  {
    name: "a delegated run",
    props: listProps(RUN_SESSION),
    menu: [
      { id: CHAT_HISTORY_ROW_MENU_ID.pin },
      { id: CHAT_HISTORY_ROW_MENU_ID.share },
      { id: CHAT_HISTORY_ROW_MENU_ID.rename },
    ],
    menuMustNotContain: [
      CHAT_HISTORY_ROW_MENU_ID.archive,
      CHAT_HISTORY_ROW_MENU_ID.unarchive,
    ],
    check: (container) => {
      const origin = text(container, "chat-history-item-run-origin");
      return [
        ...(origin ? [] : ["no origin line on a delegated run"]),
        ...(origin && !rowLabel(container).includes(origin)
          ? ["the accessible name omits where the run came from"]
          : []),
        ...(container.querySelector('[data-testid="chat-generation-status"]')
          ? []
          : ["no status dot for a run with a recorded outcome"]),
      ];
    },
  },
  {
    name: "a row at the pin limit",
    props: listProps(ACTIVE_SESSION, {
      pinnedChatsCount: 3,
      pinnedChatsLimit: 3,
    }),
    menu: [{ id: CHAT_HISTORY_ROW_MENU_ID.pin, disabled: true }],
    menuMustNotContain: [],
  },
  {
    name: "a row without edit rights",
    props: listProps({ ...ACTIVE_SESSION, canEdit: false }),
    menu: [
      { id: CHAT_HISTORY_ROW_MENU_ID.pin, disabled: true },
      { id: CHAT_HISTORY_ROW_MENU_ID.share, disabled: true },
      { id: CHAT_HISTORY_ROW_MENU_ID.rename, disabled: true },
      // Archiving is not an edit of the chat, so it stays open.
      { id: CHAT_HISTORY_ROW_MENU_ID.archive },
    ],
    menuMustNotContain: [CHAT_HISTORY_ROW_MENU_ID.unarchive],
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
    menu: [],
    menuMustNotContain: Object.values(CHAT_HISTORY_ROW_MENU_ID),
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
      const items = harness.openRowMenu(container);
      for (const failure of [
        ...menuFailures(items, conformanceCase),
        ...(conformanceCase.check?.(container) ?? []),
      ]) {
        failures.push(`${conformanceCase.name}: ${failure}`);
      }
    } finally {
      unmount();
    }
  }

  return failures;
};
