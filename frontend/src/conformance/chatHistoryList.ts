/**
 * Reports failures rather than asserting: each side ends with one
 * `expect(failures).toEqual([])`. Assertions read ids and test ids, never
 * label text, because a kit's harness activates its own catalog.
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
  render: (element: ReactElement) => {
    container: HTMLElement;
    unmount: () => void;
  };
  /** Opened by the caller: a kit's trailing menu mounts on hover. */
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
 * Searched upwards first and then inside: the host names the row element
 * itself, while a kit may label an ancestor or a descendant instead.
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
 * The statuses that change what the row's menu does. They live in a host
 * store, not on the session, so the runner writes the store instead.
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
 * which is what an absent flag means on a `DropdownMenuItem`.
 */
interface RequiredMenuItem {
  id: string;
  disabled?: boolean;
  confirmAction?: boolean;
}

interface ConformanceCase {
  name: string;
  props: ChatHistoryListProps;
  status?: ConformanceRowStatus;
  /**
   * A case where no row may appear at all, and the failure to report if one
   * does. The menu fields go unread.
   */
  noRow?: string;
  /** Ids that must be present, in whatever order the override draws them. */
  menu: readonly RequiredMenuItem[];
  menuMustNotContain: readonly string[];
  check?: (container: HTMLElement) => string[];
}

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
    name: "a list that is still loading",
    props: listProps(ACTIVE_SESSION, { isLoading: true }),
    noRow: "draws a row while the list is still loading",
    menu: [],
    menuMustNotContain: [],
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
    if (conformanceCase.noRow) {
      return row(container) ? [conformanceCase.noRow] : [];
    }
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

export interface ChatHistoryConformanceOptions {
  /**
   * Menu ids this deployment's policy removes, so the cases stop requiring
   * them. An id no case requires is reported as a failure rather than ignored.
   */
  omit?: readonly string[];
}

/**
 * Every id the cases name, required or forbidden. Exported for the host's own
 * shape test and deliberately not re-exported from `./index.ts`.
 */
export const CHAT_HISTORY_ROW_CONTRACT_IDS: readonly string[] = [
  ...new Set(
    CASES.flatMap((conformanceCase) => [
      ...conformanceCase.menu.map((item) => item.id),
      ...conformanceCase.menuMustNotContain,
    ]),
  ),
].sort();

export const chatHistoryListConformanceFailures = (
  List: ComponentType<ChatHistoryListProps>,
  harness: ChatHistoryConformanceHarness,
  { omit = [] }: ChatHistoryConformanceOptions = {},
): string[] => {
  const required = new Set(
    CASES.flatMap(({ menu }) => menu.map(({ id }) => id)),
  );
  const failures: string[] = omit
    .filter((id) => !required.has(id))
    .map((id) => `omitted "${id}" is required by no case; drop it`);
  const generationStatus = useGenerationStatusStore.getState();

  for (const conformanceCase of CASES) {
    applyRowStatus(
      conformanceCase.props.sessions[0].id,
      conformanceCase.status,
    );
    try {
      const applied = {
        ...conformanceCase,
        menu: conformanceCase.menu.filter(({ id }) => !omit.includes(id)),
      };
      for (const failure of caseFailures(List, harness, applied)) {
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
