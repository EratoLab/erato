/**
 * The row behaviours any `ChatHistoryList` override has to keep, authored by
 * the host so that a kit which has never heard of a rule still goes red the
 * day it drops one. Both sides run the same cases against their own list.
 *
 * Deliberately framework-free: the caller supplies rendering and menu opening,
 * because a kit's trailing menu mounts on hover while the host's does not, and
 * this module must not drag a test runner in behind it. It reports failures
 * rather than asserting, so each side ends with one
 * `expect(failures).toEqual([])`.
 *
 * Assertions read ids, test ids and relations — never label text: a kit's test
 * harness activates its own catalog, so host copy is unreadable there.
 */
/* eslint-disable lingui/no-unlocalized-strings -- failure text for a test run, never shown to a user */
import { createElement } from "react";

import { CHAT_HISTORY_ROW_MENU_ID } from "@/components/ui/Chat/chatHistoryRowMenuIds";
import { CHAT_HISTORY_ROW_TEST_ID } from "@/components/ui/Chat/chatHistoryRowTestIds";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { DELEGATION_PROVENANCE_KIND } from "@/utils/chat/recentChatSession";

import type { ChatHistoryListProps } from "@/components/ui/Chat/ChatHistoryList";
import type { DropdownMenuItem } from "@/components/ui/Controls/DropdownMenu";
import type { ChatSession } from "@/types/chat";
import type { ChatAttentionStatus } from "@/utils/chatHistoryGrouping";
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
  container.querySelector(`[${CHAT_HISTORY_ROW_TEST_ID.row}]`);

/**
 * Searched upwards first and then inside, because both are legal markup: the
 * host names the row element itself, while a kit that marks the `<li>` and
 * labels the button within it is just as correct.
 */
const rowLabel = (container: HTMLElement) => {
  const element = row(container);
  const labelled =
    element?.closest("[aria-label]") ?? element?.querySelector("[aria-label]");
  return labelled?.getAttribute("aria-label") ?? "";
};

const text = (container: HTMLElement, testId: string) =>
  container.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ??
  null;

/**
 * The statuses that change what the row's menu does. They live in a host store
 * rather than on the session, so a fixture cannot state one as data; the runner
 * writes the store instead. This module is built as a sibling entry of the
 * shared surface, so that store is the same instance as the one behind the
 * hooks a kit imports from `@erato/frontend/shared`.
 */
type ConformanceRowStatus = "running" | "action_required";

const STATUS_STARTED_AT = new Date("2024-01-03T00:00:00.000Z").toISOString();

const applyRowStatus = (
  chatId: string,
  status: ConformanceRowStatus | undefined,
) => {
  if (!status) {
    return;
  }
  useGenerationStatusStore.setState({
    statusByChatId: {
      [chatId]: {
        kind: status,
        startedAt: STATUS_STARTED_AT,
        localSeenAt: Date.now(),
      },
    },
    currentChatId: null,
  });
};

const statusDotFailures = (
  container: HTMLElement,
  status: ChatAttentionStatus,
): string[] => {
  const dot = container.querySelector(
    `[data-testid="${CHAT_HISTORY_ROW_TEST_ID.status}"]`,
  );
  if (!dot) {
    // Named here rather than in a comment: every status case failing this way
    // at once means the store below is not the store the override reads.
    return [
      `no status dot on a "${status}" row (if every status case fails, the test build holds two copies of @erato/frontend)`,
    ];
  }

  const shown = dot.getAttribute("data-status");
  const label = dot.getAttribute("title") ?? "";
  return [
    ...(shown === status
      ? []
      : [`the status dot reads "${shown}", expected "${status}"`]),
    ...(label !== "" && rowLabel(container).includes(label)
      ? []
      : ["the accessible name omits the row's status"]),
  ];
};

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
  /** Status to put the listed chat in first; the row then has to show it. */
  status?: ConformanceRowStatus;
  /** Ids that must be present, in whatever order the override draws them. */
  menu: readonly RequiredMenuItem[];
  /** Ids the gates drop for this row, which must not come back. */
  menuMustNotContain: readonly string[];
  check?: (container: HTMLElement) => string[];
}

/**
 * A required set in any order, not the exact array: the stable ids exist so a
 * kit can reorder the host's items and slot its own between them, and a suite
 * that goes red for that is a suite the kit stops running. Order is left to
 * the kit because no ordering failure costs a user a feature. A required id
 * missing, a wrong gate, or an id the host drops for this row rendered anyway
 * all still fail — a visible inert action is worse than a missing one.
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

  for (const { id, disabled = false, confirmAction = false } of menu) {
    const at = ids.indexOf(id);
    if (at === -1) {
      failures.push(`"${id}" is missing; ${rendered}`);
      continue;
    }

    const item = items[at];
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
      ...(text(container, CHAT_HISTORY_ROW_TEST_ID.archived) === null
        ? []
        : ["an unarchived row renders the archived pill"]),
      ...(text(container, CHAT_HISTORY_ROW_TEST_ID.runOrigin) === null
        ? []
        : ["an ordinary chat renders a delegated-run origin"]),
      ...(container.querySelector(
        `[data-testid="${CHAT_HISTORY_ROW_TEST_ID.status}"]`,
      )
        ? ["an idle row renders a status dot"]
        : []),
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
      const pill = text(container, CHAT_HISTORY_ROW_TEST_ID.archived);
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
      const origin = text(container, CHAT_HISTORY_ROW_TEST_ID.runOrigin);
      return [
        ...(origin ? [] : ["no origin line on a delegated run"]),
        ...(origin && !rowLabel(container).includes(origin)
          ? ["the accessible name omits where the run came from"]
          : []),
        ...statusDotFailures(container, "error"),
      ];
    },
  },
  {
    // The pair the whole contract exists for: archiving is reversible, so it
    // asks first only where unarchiving cannot put the work back.
    name: "a row that is still generating",
    props: listProps(ACTIVE_SESSION),
    status: "running",
    menu: [
      { id: CHAT_HISTORY_ROW_MENU_ID.pin },
      { id: CHAT_HISTORY_ROW_MENU_ID.share },
      { id: CHAT_HISTORY_ROW_MENU_ID.rename },
      { id: CHAT_HISTORY_ROW_MENU_ID.archive, confirmAction: true },
    ],
    menuMustNotContain: [CHAT_HISTORY_ROW_MENU_ID.unarchive],
  },
  {
    name: "a row waiting on a tool approval",
    props: listProps(ACTIVE_SESSION),
    status: "action_required",
    menu: [
      { id: CHAT_HISTORY_ROW_MENU_ID.pin },
      { id: CHAT_HISTORY_ROW_MENU_ID.share },
      { id: CHAT_HISTORY_ROW_MENU_ID.rename },
      { id: CHAT_HISTORY_ROW_MENU_ID.archive, confirmAction: true },
    ],
    menuMustNotContain: [CHAT_HISTORY_ROW_MENU_ID.unarchive],
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

const caseFailures = (
  List: ComponentType<ChatHistoryListProps>,
  harness: ChatHistoryConformanceHarness,
  conformanceCase: ConformanceCase,
): string[] => {
  const { container, unmount } = harness.render(
    createElement(List, conformanceCase.props),
  );
  try {
    if (!row(container)) {
      return ["renders no row at all"];
    }
    return [
      ...menuFailures(harness.openRowMenu(container), conformanceCase),
      ...(conformanceCase.status
        ? statusDotFailures(container, conformanceCase.status)
        : []),
      ...(conformanceCase.check?.(container) ?? []),
    ];
  } finally {
    unmount();
  }
};

export const chatHistoryListConformanceFailures = (
  List: ComponentType<ChatHistoryListProps>,
  harness: ChatHistoryConformanceHarness,
): string[] => {
  const failures: string[] = [];
  const generationStatus = useGenerationStatusStore.getState();

  for (const conformanceCase of CASES) {
    applyRowStatus(
      conformanceCase.props.sessions[0].id,
      conformanceCase.status,
    );
    try {
      for (const failure of caseFailures(List, harness, conformanceCase)) {
        failures.push(`${conformanceCase.name}: ${failure}`);
      }
    } finally {
      // Restored after every case, not just the ones that set it: a status
      // left behind would silently change what the next case is testing.
      useGenerationStatusStore.setState(generationStatus, true);
    }
  }

  return failures;
};
