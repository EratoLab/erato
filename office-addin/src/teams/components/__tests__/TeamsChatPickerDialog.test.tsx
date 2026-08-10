import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MOCK_CHAT_ID,
  mockGraphChatMessage,
} from "../../../test/mocks/teams/graph";
import {
  TeamsChatPickerProvider,
  useTeamsChatPicker,
} from "../../providers/TeamsChatPickerProvider";

import type { UseTeamsChatListResult } from "../../hooks/useTeamsChatList";
import type { UseTeamsChatMessagesResult } from "../../hooks/useTeamsChatMessages";
import type { UseTeamsChatSearchResult } from "../../hooks/useTeamsChatSearch";
import type { ParsedTeamsChat } from "../../utils/parsedTeamsChat";
import type { TeamsChatFetcher } from "../../utils/teamsChatFetcher";
import type { PageChatMessagesResult } from "../../utils/teamsChatPager";
import type { ReactNode } from "react";

/* --------------------------------------------------------------- library */

vi.mock("@erato/frontend/library", () => ({
  ModalBase: ({
    children,
    isOpen,
    title,
  }: {
    children: ReactNode;
    isOpen: boolean;
    title?: string;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
  Button: ({
    children,
    icon,
    loading,
    disabled,
    onClick,
    ...rest
  }: {
    children?: ReactNode;
    icon?: ReactNode;
    loading?: boolean;
    disabled?: boolean;
    onClick?: () => void;
    geometry?: string;
    variant?: string;
  }) => (
    <button
      type="button"
      disabled={disabled ?? loading ?? false}
      onClick={onClick}
      {...omitStyleProps(rest)}
    >
      {children ?? icon}
    </button>
  ),
  Input: ({
    value,
    onChange,
    placeholder,
    type,
    "aria-label": ariaLabel,
  }: {
    value?: string;
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    type?: string;
    "aria-label"?: string;
  }) => (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  ),
  Alert: ({ children, type }: { children: ReactNode; type: string }) => (
    <div role="alert" data-alert-type={type}>
      {children}
    </div>
  ),
  MessageTimestamp: ({ createdAt }: { createdAt: Date }) => (
    <time dateTime={createdAt.toISOString()}>{createdAt.toISOString()}</time>
  ),
  InteractiveContainer: ({
    children,
    onClick,
    "aria-label": ariaLabel,
  }: {
    children: ReactNode;
    onClick?: () => void;
    "aria-label"?: string;
  }) => (
    <button type="button" onClick={onClick} aria-label={ariaLabel}>
      {children}
    </button>
  ),
  ArrowLeftIcon: () => null,
  CloseIcon: () => null,
  FolderIcon: () => null,
  SearchIcon: () => null,
  FILE_PREVIEW_STYLES: { progress: { container: "", bar: "" } },
  useFileUploadStore: { getState: () => hooks.uploadStore },
}));

function omitStyleProps(props: Record<string, unknown>) {
  const { geometry, variant, ...rest } = props;
  void geometry;
  void variant;
  return rest;
}

/* ------------------------------------------------------------ data hooks */

const hooks = vi.hoisted(() => ({
  fetcher: null as TeamsChatFetcher | null,
  chatList: null as UseTeamsChatListResult | null,
  messages: null as UseTeamsChatMessagesResult | null,
  search: null as UseTeamsChatSearchResult | null,
  /** Stands in for the composer's shared upload store. */
  uploadStore: { isUploading: false, error: null as Error | null },
}));

vi.mock("../../providers/TeamsProvider", () => ({
  useTeams: () => ({ userPrincipalName: "me@example.com" }),
}));
vi.mock("../../hooks/useTeamsChatFetcher", () => ({
  useTeamsChatFetcher: () => ({
    fetcher: hooks.fetcher,
    unavailableReason: hooks.fetcher ? null : "graph-unavailable",
  }),
}));
vi.mock("../../hooks/useTeamsChatList", () => ({
  useTeamsChatList: () => hooks.chatList,
}));
vi.mock("../../hooks/useTeamsChatMessages", () => ({
  useTeamsChatMessages: () => hooks.messages,
}));
vi.mock("../../hooks/useTeamsChatSearch", () => ({
  MIN_SEARCH_QUERY_LENGTH: 3,
  useTeamsChatSearch: () => hooks.search,
}));
vi.mock("../../hooks/useTeamsChatTitles", () => ({
  useTeamsChatTitles: () => new Map(),
}));

/* -------------------------------------------------------------- fixtures */

const PRODUCT_SYNC: ParsedTeamsChat = {
  chatId: MOCK_CHAT_ID,
  title: "Product sync",
  participants: ["Ada Lovelace", "Grace Hopper"],
  participantsTruncated: false,
  chatType: "group",
  lastActivityAt: "2026-08-10T09:15:00Z",
  previewText: "Works for me.",
};

const OLDEST = mockGraphChatMessage({
  id: "1741000000000",
  createdDateTime: "2026-03-03T09:14:00Z",
  body: { contentType: "text", content: "Can we move the sync to Thursday?" },
});
const NEWEST = mockGraphChatMessage({
  id: "1754000000000",
  createdDateTime: "2026-08-10T09:15:00Z",
  from: { user: { id: "u2", displayName: "Grace Hopper" } },
  body: { contentType: "text", content: "Works for me." },
});

function chatListResult(
  overrides: Partial<UseTeamsChatListResult> = {},
): UseTeamsChatListResult {
  const chats = overrides.chats ?? [PRODUCT_SYNC];
  return {
    chats,
    chatsById: new Map(chats.map((chat) => [chat.chatId, chat])),
    isLoading: false,
    isError: false,
    isPartial: false,
    hasMore: false,
    isLoadingMore: false,
    loadMore: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function messagesResult(
  overrides: Partial<UseTeamsChatMessagesResult> = {},
): UseTeamsChatMessagesResult {
  return {
    messages: [],
    isLoading: false,
    isError: false,
    isPartial: false,
    hasMore: false,
    isLoadingMore: false,
    loadEarlier: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function searchResult(
  overrides: Partial<UseTeamsChatSearchResult> = {},
): UseTeamsChatSearchResult {
  return {
    hits: [],
    isLoading: false,
    isError: false,
    hasMore: false,
    isLoadingMore: false,
    loadMore: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function fakeFetcher(
  page: Partial<PageChatMessagesResult> = {},
): TeamsChatFetcher {
  return {
    listChats: () =>
      Promise.resolve({ chats: [], nextLink: null, state: "ok" }),
    getChat: () => Promise.resolve(null),
    listMessagesPage: () =>
      Promise.resolve({ messages: [], nextLink: null, status: 200, ok: true }),
    searchMessages: () =>
      Promise.resolve({
        hits: [],
        moreResultsAvailable: false,
        nextFrom: 0,
        state: "ok",
      }),
    pageChatBackwards: (args) => {
      args.onProgress?.({
        conversationKey: args.chatId,
        fetched: 2,
        limit: args.limit ?? 200,
        oldestCreatedDateTime: OLDEST.createdDateTime ?? null,
      });
      return Promise.resolve({
        messages: [NEWEST, OLDEST],
        nextLink: "https://graph.microsoft.com/next",
        oldestCreatedDateTime: OLDEST.createdDateTime ?? null,
        state: "ok",
        ...page,
      });
    },
    getMessage: () => Promise.resolve(NEWEST),
  };
}

/** A fetcher whose paging parks until released, and honours an abort. */
function blockedFetcher(): {
  fetcher: TeamsChatFetcher;
  release: () => void;
} {
  const base = fakeFetcher();
  let resolveGate: (() => void) | null = null;
  return {
    release: () => resolveGate?.(),
    fetcher: {
      ...base,
      pageChatBackwards: async (args) => {
        args.onProgress?.({
          conversationKey: args.chatId,
          fetched: 2,
          limit: 200,
          oldestCreatedDateTime: OLDEST.createdDateTime ?? null,
        });
        await new Promise<void>((resolve, reject) => {
          resolveGate = resolve;
          args.signal?.addEventListener(
            "abort",
            () => reject(args.signal?.reason ?? new Error("aborted")),
            { once: true },
          );
        });
        return base.pageChatBackwards(args);
      },
    },
  };
}

/* ----------------------------------------------------------------- harness */

const uploads: File[][] = [];

function Opener() {
  const { open } = useTeamsChatPicker();
  return (
    <button
      type="button"
      onClick={() =>
        open((files) => {
          uploads.push(files);
          return Promise.resolve();
        })
      }
    >
      open picker
    </button>
  );
}

function renderPicker() {
  const view = render(
    <TeamsChatPickerProvider>
      <Opener />
    </TeamsChatPickerProvider>,
  );
  fireEvent.click(screen.getByText("open picker"));
  return view;
}

const selectChat = () =>
  screen.getByRole("checkbox", { name: "Select Product sync" });

describe("TeamsChatPickerDialog", () => {
  let originalOffice: PropertyDescriptor | undefined;

  beforeEach(() => {
    i18n.activate("en");
    uploads.length = 0;
    hooks.uploadStore = { isUploading: false, error: null };
    hooks.fetcher = fakeFetcher();
    hooks.chatList = chatListResult();
    hooks.messages = messagesResult();
    hooks.search = searchResult();
    // The Teams route never loads Office.js, so nothing here may need it.
    originalOffice = Object.getOwnPropertyDescriptor(globalThis, "Office");
    Reflect.deleteProperty(globalThis, "Office");
  });

  afterEach(() => {
    cleanup();
    if (originalOffice) {
      Object.defineProperty(globalThis, "Office", originalOffice);
    }
  });

  it("opens on the browse view with no Office global and no Outlook provider", () => {
    renderPicker();

    expect(screen.getByRole("dialog", { name: "Teams chats" })).toBeVisible();
    expect(screen.getByText("Product sync")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Filter Teams chats or search messages"),
    ).toHaveValue("");
    expect(globalThis).not.toHaveProperty("Office");
  });

  it("keeps Attach inert until something is ticked", () => {
    renderPicker();

    const attach = screen.getByRole("button", { name: "Attach" });
    expect(attach).toBeDisabled();

    fireEvent.click(selectChat());
    expect(attach).toBeEnabled();
    expect(screen.getByText("1 item selected")).toBeInTheDocument();
  });

  it("names the ingest bound and raises it on request", () => {
    renderPicker();

    expect(
      screen.getByText("Whole chats add the last 200 messages."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Include earlier" }));

    expect(
      screen.getByText("Whole chats add the last 400 messages."),
    ).toBeInTheDocument();
  });

  it("attaches one markdown file carrying the fetched conversation", async () => {
    renderPicker();
    fireEvent.click(selectChat());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    });

    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0]).toHaveLength(1);
    const file = uploads[0][0];
    expect(file.name).toBe("teams-Product_sync.md");
    expect(file.type).toBe("text/markdown");

    const text = await file.text();
    expect(text).toContain("# Teams chat: Product sync");
    expect(text).toContain("Can we move the sync to Thursday?");
    expect(text).toContain("Works for me.");
    // Dialog closes on a clean attach.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("records the window that was actually fetched in the transcript", async () => {
    renderPicker();
    fireEvent.click(selectChat());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    });
    await waitFor(() => expect(uploads).toHaveLength(1));

    const text = await uploads[0][0].text();
    expect(text).toContain(
      "Included: last 2 messages, 3 March 2026 – 10 August 2026. Older messages were not included.",
    );
  });

  it("reports an untruncated window as such", async () => {
    hooks.fetcher = fakeFetcher({ nextLink: null });
    renderPicker();
    fireEvent.click(selectChat());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    });
    await waitFor(() => expect(uploads).toHaveLength(1));

    const text = await uploads[0][0].text();
    expect(text).toContain(
      "Included: all 2 messages, 3 March 2026 – 10 August 2026.",
    );
    expect(text).not.toContain("Older messages were not included.");
  });

  it("keeps ticks across browse → search → browse", async () => {
    hooks.search = searchResult({
      hits: [
        {
          chatId: MOCK_CHAT_ID,
          messageId: "1754000000000",
          senderName: "Grace Hopper",
          createdAt: "2026-08-10T09:15:00Z",
          summary: "Works <c0>for</c0> me.",
        },
      ],
    });
    renderPicker();

    fireEvent.click(selectChat());
    expect(selectChat()).toBeChecked();

    const field = screen.getByLabelText(
      "Filter Teams chats or search messages",
    );
    fireEvent.change(field, { target: { value: "sync" } });
    expect(
      await screen.findByRole("checkbox", {
        name: "Select message from Grace Hopper",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("for")).toBeInTheDocument();

    fireEvent.change(field, { target: { value: "" } });
    await waitFor(() => expect(selectChat()).toBeChecked());
  });

  it("finds a chat by a participant's name without waiting on search", () => {
    renderPicker();

    // Two characters is below the search threshold, so nothing has been asked
    // of Graph — the chat must still surface from the loaded list.
    fireEvent.change(
      screen.getByLabelText("Filter Teams chats or search messages"),
      { target: { value: "ho" } },
    );

    expect(
      screen.getByRole("checkbox", { name: "Select Product sync" }),
    ).toBeInTheDocument();
    expect(hooks.search?.hits ?? []).toHaveLength(0);
  });

  it("says so when no chat or person matches", () => {
    renderPicker();

    fireEvent.change(
      screen.getByLabelText("Filter Teams chats or search messages"),
      { target: { value: "nobody" } },
    );

    expect(
      screen.getByText("No chat or person matches that name."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Select Product sync" }),
    ).not.toBeInTheDocument();
  });

  it("nudges rather than searches below the minimum query length", () => {
    renderPicker();

    fireEvent.change(
      screen.getByLabelText("Filter Teams chats or search messages"),
      {
        target: { value: "sy" },
      },
    );

    expect(
      screen.getByText("Type at least 3 characters to search messages."),
    ).toBeInTheDocument();
  });

  it("distinguishes an empty chat list from an empty search", async () => {
    hooks.chatList = chatListResult({ chats: [] });
    renderPicker();

    expect(screen.getByText("No Teams chats found.")).toBeInTheDocument();

    fireEvent.change(
      screen.getByLabelText("Filter Teams chats or search messages"),
      {
        target: { value: "sync" },
      },
    );

    expect(await screen.findByText("No messages match “sync”.")).toBeVisible();
  });

  it("offers a retry instead of an empty list when browsing fails", () => {
    const refetch = vi.fn();
    hooks.chatList = chatListResult({ isError: true, refetch });
    renderPicker();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't load your Teams chats.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps throttled rows on screen with a note", () => {
    hooks.chatList = chatListResult({ isPartial: true });
    renderPicker();

    expect(screen.getByText("Product sync")).toBeInTheDocument();
    expect(
      screen.getByText("Showing partial results — Teams is rate-limiting."),
    ).toBeInTheDocument();
  });

  it("exposes determinate build progress while paging", async () => {
    const blocked = blockedFetcher();
    hooks.fetcher = blocked.fetcher;

    renderPicker();
    fireEvent.click(selectChat());
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));

    const bar = await screen.findByRole("progressbar", {
      name: "Loading Teams messages",
    });
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "4");

    await act(async () => {
      blocked.release();
    });
    await waitFor(() => expect(uploads).toHaveLength(1));
  });

  it("treats cancelling a build as a cancel, not a failure", async () => {
    hooks.fetcher = blockedFetcher().fetcher;

    renderPicker();
    fireEvent.click(selectChat());
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    await screen.findByRole("progressbar");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(uploads).toHaveLength(0);
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(selectChat()).toBeChecked();
  });

  it("offers the partial transcript rather than discarding it", async () => {
    hooks.fetcher = fakeFetcher({ state: "partial" });
    renderPicker();
    fireEvent.click(selectChat());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    });

    expect(
      await screen.findByText(
        "Loaded 1 of 1 conversations. Attach what was loaded?",
      ),
    ).toBeInTheDocument();
    expect(uploads).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach anyway" }));
    });
    await waitFor(() => expect(uploads).toHaveLength(1));
  });

  it("puts the partial transcript back on offer when the upload fails", async () => {
    hooks.fetcher = fakeFetcher({ state: "partial" });
    hooks.uploadStore.error = new Error("413");
    renderPicker();
    fireEvent.click(selectChat());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach anyway" }));
    });

    expect(
      screen.getByText("Couldn't attach the transcript. Try again."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Attach anyway" }),
    ).toBeInTheDocument();
  });

  it("keeps the selection and reuses the build when the upload fails", async () => {
    const base = fakeFetcher();
    const pageChatBackwards = vi.fn(base.pageChatBackwards);
    hooks.fetcher = { ...base, pageChatBackwards };
    hooks.uploadStore.error = new Error("413");

    renderPicker();
    fireEvent.click(selectChat());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    });

    expect(
      await screen.findByText("Couldn't attach the transcript. Try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(selectChat()).toBeChecked();
    expect(pageChatBackwards).toHaveBeenCalledTimes(1);

    hooks.uploadStore.error = null;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    });

    await waitFor(() => expect(uploads).toHaveLength(2));
    // The transcript already fetched is re-offered rather than walked again.
    expect(pageChatBackwards).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers older pages when the newest one holds nothing renderable", () => {
    hooks.messages = messagesResult({ messages: [], hasMore: true });
    renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "Open Product sync" }));

    expect(
      screen.getByText(
        "Nothing to show on this page — load more to keep looking.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Load earlier messages" }),
    ).toBeInTheDocument();
  });

  it("never uploads an empty transcript", async () => {
    hooks.fetcher = fakeFetcher({ messages: [] });
    renderPicker();
    fireEvent.click(selectChat());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    });

    expect(
      await screen.findByText(
        "Nothing to attach — the selected messages have no readable content.",
      ),
    ).toBeInTheDocument();
    expect(uploads).toHaveLength(0);
    expect(selectChat()).toBeChecked();
  });
});
