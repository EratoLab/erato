import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MOCK_CHAT_ID,
  mockGraphChatMessage,
} from "../../../test/mocks/teams/graph";
import {
  TeamsChatPickerProvider,
  useTeamsChatPicker,
} from "../../providers/TeamsChatPickerProvider";
import { parseTeamChannels } from "../../utils/parsedTeamsChannel";

import type { UseTeamsChannelListResult } from "../../hooks/useTeamsChannelList";
import type { UseTeamsChatListResult } from "../../hooks/useTeamsChatList";
import type { UseTeamsChatMessagesResult } from "../../hooks/useTeamsChatMessages";
import type { UseTeamsChatSearchResult } from "../../hooks/useTeamsChatSearch";
import type { TeamsComposerBridge } from "../../hooks/useTeamsComposerBridge";
import type { ParsedTeamsChat } from "../../utils/parsedTeamsChat";
import type {
  TeamsChannelFetcher,
  TeamsChatFetcher,
  TeamsFileFetcher,
} from "../../utils/teamsChatFetcher";
import type { PageChatMessagesResult } from "../../utils/teamsChatPager";
import type { TeamsChatSelection } from "../../utils/teamsChatSelection";
import type { TeamsTranscriptRecord } from "../../utils/teamsComposerTranscripts";
import type { FileUploadItem } from "@erato/frontend/library";
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
      // As the library's Button: loading disables whatever `disabled` says.
      disabled={Boolean(disabled) || Boolean(loading)}
      aria-busy={loading || undefined}
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
  PageIcon: () => null,
  SearchIcon: () => null,
  // The mock carries the primitive's ARIA contract: `aria-hidden` is what
  // drops `role="status"`, and that is what the test asserts.
  SpinnerIcon: ({
    "aria-hidden": ariaHidden,
    className,
  }: {
    "aria-hidden"?: boolean;
    className?: string;
  }) =>
    ariaHidden ? (
      <span data-ui="spinner" aria-hidden="true" className={className} />
    ) : (
      <span data-ui="spinner" role="status" className={className}>
        Loading...
      </span>
    ),
  FilePreviewModal: ({
    isOpen,
    file,
    notPreviewableReason,
  }: {
    isOpen: boolean;
    file: { filename: string; preview_url?: string | null } | null;
    notPreviewableReason?: string;
  }) =>
    isOpen && file ? (
      <div role="dialog" aria-label={`Preview ${file.filename}`}>
        {file.preview_url ?? notPreviewableReason}
      </div>
    ) : null,
  FILE_PREVIEW_STYLES: { progress: { container: "", bar: "" } },
  useFileUploadStore: { getState: () => hooks.uploadStore },
  readTeamsTranscriptIndex: () => Promise.resolve(null),
  useFeatureConfig: () => ({ upload: { maxSizeBytes: 10 * 1024 * 1024 } }),
  mapOutsideCodeFences: (
    text: string,
    transform: (segment: string) => string,
  ) => transform(text),
  // Tag-stripping stand-in; the real block handling has its own unit tests.
  htmlToPlainText: (html: string) => {
    let text = html;
    for (let previous = ""; text !== previous; ) {
      previous = text;
      text = text.replace(/<[^>]+>/g, "");
    }
    return text;
  },
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
  channelFetcher: null as TeamsChannelFetcher | null,
  fileFetcher: null as TeamsFileFetcher | null,
  chatList: null as UseTeamsChatListResult | null,
  channelList: null as UseTeamsChannelListResult | null,
  messages: null as UseTeamsChatMessagesResult | null,
  channelMessages: null as UseTeamsChatMessagesResult | null,
  search: null as UseTeamsChatSearchResult | null,
  /** Stands in for the composer's shared upload store. */
  uploadStore: { isUploading: false, error: null as Error | null },
  /** How many files the composer's upload takes (its `maxFiles`). */
  uploadLimit: 5,
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
vi.mock("../../hooks/useTeamsChannelFetcher", () => ({
  useTeamsChannelFetcher: () => ({
    fetcher: hooks.channelFetcher,
    unavailableReason: hooks.channelFetcher ? null : "graph-unavailable",
  }),
}));
vi.mock("../../hooks/useTeamsFileFetcher", () => ({
  useTeamsFileFetcher: () => ({
    fetcher: hooks.fileFetcher,
    unavailableReason: hooks.fileFetcher ? null : "graph-unavailable",
  }),
}));
vi.mock("../../hooks/useTeamsChannelList", () => ({
  useTeamsChannelList: () => hooks.channelList,
}));
vi.mock("../../hooks/useTeamsChannelMessages", () => ({
  useTeamsChannelMessages: () => hooks.channelMessages,
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
  selfDisplayName: null,
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

function channelListResult(
  overrides: Partial<UseTeamsChannelListResult> = {},
): UseTeamsChannelListResult {
  const channels = overrides.channels ?? [];
  return {
    channels,
    channelsByKey: new Map(
      channels.map((channel) => [
        `${channel.teamId}/${channel.channelId}`,
        channel,
      ]),
    ),
    isLoading: false,
    isError: false,
    isPartial: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

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
    isRefreshing: false,
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
      const merged = {
        messages: [NEWEST, OLDEST],
        nextLink: "https://graph.microsoft.com/next" as string | null,
        oldestCreatedDateTime: OLDEST.createdDateTime ?? null,
        state: "ok" as const,
        ...page,
      };
      return Promise.resolve({
        truncated: merged.nextLink !== null,
        ...merged,
      });
    },
    getMessage: () => Promise.resolve(NEWEST),
    getHostedContent: () => Promise.resolve(null),
  };
}

function fakeChannelFetcher(
  overrides: Partial<TeamsChannelFetcher> = {},
): TeamsChannelFetcher {
  return {
    listJoinedTeams: () => Promise.resolve({ teams: [], state: "ok" }),
    listChannels: () => Promise.resolve({ channels: [], state: "ok" }),
    listMessagesPage: () =>
      Promise.resolve({ messages: [], nextLink: null, status: 200, ok: true }),
    probeMessage: () => Promise.resolve({ message: null, status: 404 }),
    getHostedContent: () => Promise.resolve(null),
    getReply: () => Promise.resolve(null),
    pageChannelBackwards: () =>
      Promise.resolve({
        messages: [],
        nextLink: null,
        truncated: false,
        oldestCreatedDateTime: null,
        state: "ok",
      }),
    ...overrides,
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

/**
 * Stands in for the Teams composer. Its upload fails the way the composer's
 * does (busy, or an upload error), and otherwise returns minted uploads, at
 * most `uploadLimit` of them.
 */
function bridgeDouble(): TeamsComposerBridge {
  let round = 0;
  return {
    upload: vi.fn(async (files: File[]) => {
      uploads.push(files);
      if (hooks.uploadStore.isUploading || hooks.uploadStore.error) {
        return null;
      }
      round += 1;
      return files.slice(0, hooks.uploadLimit).map(
        (file, index) =>
          ({
            id: `r${round}-${index}`,
            filename: file.name,
          }) as FileUploadItem,
      );
    }),
    add: vi.fn(),
    replace: vi.fn(),
    remove: vi.fn(),
    claimedIds: vi.fn((record: TeamsTranscriptRecord) => [
      record.transcriptUploadId,
      ...record.assetUploadIds,
    ]),
    announce: vi.fn(),
    focusComposer: vi.fn(),
  };
}

let bridge = bridgeDouble();

function Opener({ edit }: { edit?: TeamsTranscriptRecord }) {
  const { open, transcripts } = useTeamsChatPicker();
  return (
    <>
      <button type="button" onClick={() => open(bridge)}>
        open picker
      </button>
      <button
        type="button"
        onClick={() =>
          open(bridge, { edit: edit ?? [...transcripts.values()][0] })
        }
      >
        edit transcript
      </button>
    </>
  );
}

/** Surfaces the records a composer reads its chips from. */
function AttachedProbe() {
  const { transcripts } = useTeamsChatPicker();
  return (
    <ul data-testid="attached-transcripts">
      {[...transcripts.values()].map((record) => (
        <li key={record.transcriptUploadId} data-lineage={record.lineage}>
          {`${record.transcriptUploadId}:${record.file.name}:${record.assetUploadIds.join(",")}`}
        </li>
      ))}
    </ul>
  );
}

const records = () =>
  [...screen.getByTestId("attached-transcripts").querySelectorAll("li")].map(
    (item) => item.textContent,
  );

function renderPicker(
  options: {
    open?: "attach" | "edit" | null;
    edit?: TeamsTranscriptRecord;
  } = {},
) {
  const { open = "attach", edit } = options;
  // StrictMode on purpose: the app runs under it, and its double-mount is what
  // exposed the alive-ref arming bug the plain renderer never would.
  const view = render(
    <StrictMode>
      <TeamsChatPickerProvider>
        <Opener edit={edit} />
        <AttachedProbe />
      </TeamsChatPickerProvider>
    </StrictMode>,
  );
  if (open === "attach") fireEvent.click(screen.getByText("open picker"));
  if (open === "edit") fireEvent.click(screen.getByText("edit transcript"));
  return view;
}

const selectChat = () =>
  screen.getByRole("checkbox", { name: "Select Product sync" });

/** Holds the composer's upload open until the test lets it finish. */
function holdUpload() {
  let finish: () => void = () => {};
  const upload = bridge.upload;
  bridge.upload = vi.fn(
    (files: File[]) =>
      new Promise<FileUploadItem[] | null>((resolve) => {
        finish = () => void upload(files).then(resolve);
      }),
  );
  return { finish: () => finish() };
}

/** A chat whose one message carries a pasted image. */
function imageFetcher(): TeamsChatFetcher {
  return {
    ...fakeFetcher(),
    pageChatBackwards: () =>
      Promise.resolve({
        messages: [
          mockGraphChatMessage({
            id: "a",
            body: {
              contentType: "html",
              content: `<p>see this</p><img src="https://graph.microsoft.com/v1.0/chats/x/messages/1/hostedContents/aWQ9/$value">`,
            },
          }),
        ],
        nextLink: null,
        truncated: false,
        oldestCreatedDateTime: "2026-03-03T09:14:00Z",
        state: "ok",
      }),
    getHostedContent: () =>
      Promise.resolve({
        bytes: new TextEncoder().encode("png-bytes").buffer,
        contentType: "image/png",
      }),
  };
}

describe("TeamsChatPickerDialog", () => {
  let originalOffice: PropertyDescriptor | undefined;

  beforeEach(() => {
    i18n.activate("en");
    uploads.length = 0;
    bridge = bridgeDouble();
    hooks.uploadLimit = 5;
    hooks.uploadStore = { isUploading: false, error: null };
    hooks.fetcher = fakeFetcher();
    hooks.channelFetcher = null;
    hooks.fileFetcher = null;
    hooks.chatList = chatListResult();
    hooks.channelList = channelListResult();
    hooks.messages = messagesResult();
    hooks.channelMessages = messagesResult();
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
    // The window binds whole-conversation ticks only; with none selected the
    // control would read as a second list-paging button.
    expect(
      screen.queryByRole("button", { name: "Include earlier" }),
    ).not.toBeInTheDocument();

    fireEvent.click(selectChat());
    fireEvent.click(screen.getByRole("button", { name: "Include earlier" }));

    expect(
      screen.getByText("Whole chats add the last 400 messages."),
    ).toBeInTheDocument();
  });

  it("does not call an unreadable page the end of the channel", () => {
    hooks.channelList = channelListResult({
      channels: parseTeamChannels({ id: "t1", displayName: "Erato Labs" }, [
        { id: "c1", displayName: "Test Channel 1" },
      ]),
    });
    hooks.channelMessages = messagesResult({ messages: [], hasMore: true });
    renderPicker();

    fireEvent.click(
      screen.getByRole("button", { name: "Open Test Channel 1" }),
    );

    expect(
      screen.getByText(
        "Nothing to show on this page — load more to keep looking.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No messages in this channel yet."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Load earlier messages" }),
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
    expect(file.type).toBe("text/plain");

    const text = await file.text();
    expect(text).toContain("# Teams chat: Product sync");
    expect(text).toContain("Can we move the sync to Thursday?");
    expect(text).toContain("Works for me.");
    // Dialog closes on a clean attach.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("records the attached transcript by its upload id and stages its uploads", async () => {
    renderPicker();
    fireEvent.click(selectChat());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    });
    await waitFor(() => expect(uploads).toHaveLength(1));

    expect(records()).toEqual(["r1-0:teams-Product_sync.md:"]);
    expect(bridge.add).toHaveBeenCalledWith([
      { id: "r1-0", filename: "teams-Product_sync.md" },
    ]);
    expect(bridge.replace).not.toHaveBeenCalled();
    expect(bridge.announce).toHaveBeenCalledWith("Teams transcript attached.");
    expect(screen.queryByRole("dialog")).toBeNull();
    // The "+" row that opened the dialog is gone, so focus goes back home.
    expect(bridge.focusComposer).toHaveBeenCalled();
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
          ref: { kind: "chat" as const, chatId: MOCK_CHAT_ID },
          webLink: null,
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

  it("signals a re-running search instead of passing off stale hits as done", async () => {
    hooks.search = searchResult({
      hits: [
        {
          ref: { kind: "chat" as const, chatId: MOCK_CHAT_ID },
          webLink: null,
          messageId: "1754000000000",
          senderName: "Grace Hopper",
          createdAt: "2026-08-10T09:15:00Z",
          summary: "Works <c0>for</c0> me.",
        },
      ],
      isRefreshing: true,
    });
    renderPicker();

    fireEvent.change(
      screen.getByLabelText("Filter Teams chats or search messages"),
      { target: { value: "thursday" } },
    );

    expect(await screen.findByText("Searching…")).toBeInTheDocument();
    // The previous results stay on screen behind the indicator.
    expect(
      screen.getByRole("checkbox", {
        name: "Select message from Grace Hopper",
      }),
    ).toBeInTheDocument();
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

  it("holds the channels' place while they load behind the chats", () => {
    hooks.channelList = channelListResult({ isLoading: true });
    renderPicker();

    // Chats are already interactive while the channel rows are still coming.
    expect(selectChat()).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Loading channels…" }),
    ).toBeInTheDocument();
  });

  it("shows channels even when there are no personal chats", () => {
    hooks.chatList = chatListResult({ chats: [] });
    hooks.channelList = channelListResult({
      channels: parseTeamChannels({ id: "t1", displayName: "Erato Labs" }, [
        { id: "c1", displayName: "Test Channel 1" },
      ]),
    });
    renderPicker();

    expect(screen.queryByText("No Teams chats found.")).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Select Test Channel 1" }),
    ).toBeInTheDocument();
  });

  it("does not claim 'no matches' while channels are still loading", () => {
    hooks.channelList = channelListResult({ isLoading: true });
    renderPicker();

    fireEvent.change(
      screen.getByLabelText("Filter Teams chats or search messages"),
      { target: { value: "nobody" } },
    );

    expect(
      screen.queryByText("No chat, channel or person matches that name."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Loading channels…" }),
    ).toBeInTheDocument();
  });

  it("notes rate-limited channel listing like it does for chats", () => {
    hooks.channelList = channelListResult({ isPartial: true });
    renderPicker();

    expect(
      screen.getByText("Showing partial results — Teams is rate-limiting."),
    ).toBeInTheDocument();
  });

  it("lists channels flat beneath chats, badging restricted ones", () => {
    hooks.channelList = channelListResult({
      channels: [
        ...parseTeamChannels({ id: "t1", displayName: "Erato Labs" }, [
          { id: "c1", displayName: "Test Channel 1" },
          { id: "c2", displayName: "Leads", membershipType: "private" },
        ]),
      ],
    });
    renderPicker();

    expect(
      screen.getByRole("checkbox", { name: "Select Test Channel 1" }),
    ).toBeInTheDocument();
    // The team name disambiguates channels that share a name across teams.
    expect(screen.getAllByText("Erato Labs").length).toBeGreaterThan(0);
    expect(screen.getByText("Private")).toBeInTheDocument();
  });

  it("finds a channel by its team name", () => {
    hooks.channelList = channelListResult({
      channels: parseTeamChannels({ id: "t1", displayName: "Erato Labs" }, [
        { id: "c1", displayName: "Test Channel 1" },
      ]),
    });
    renderPicker();

    fireEvent.change(
      screen.getByLabelText("Filter Teams chats or search messages"),
      { target: { value: "erato" } },
    );

    expect(
      screen.getByRole("checkbox", { name: "Select Test Channel 1" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Select Product sync" }),
    ).not.toBeInTheDocument();
  });

  it("says so when no chat or person matches", () => {
    renderPicker();

    fireEvent.change(
      screen.getByLabelText("Filter Teams chats or search messages"),
      { target: { value: "nobody" } },
    );

    expect(
      screen.getByText("No chat, channel or person matches that name."),
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
    // Which conversation is still fetching, not just how many.
    expect(screen.getByText("Loading: Product sync…")).toBeInTheDocument();

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

  it("stays busy while the composer uploads the transcript", async () => {
    const upload = holdUpload();
    renderPicker();
    fireEvent.click(selectChat());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    });
    await waitFor(() => expect(bridge.upload).toHaveBeenCalledTimes(1));

    const attach = screen.getByRole("button", { name: "Attach" });
    expect(attach).toBeDisabled();
    expect(attach).toHaveAttribute("aria-busy", "true");
    // Closing drops the transcript (see the Update case), so Cancel stays.
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();

    await act(async () => {
      upload.finish();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(uploads).toHaveLength(1);
  });

  it("does not fail a second Attach while a re-offered transcript uploads", async () => {
    hooks.uploadStore.error = new Error("413");
    renderPicker();
    fireEvent.click(selectChat());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    });
    await screen.findByText("Couldn't attach the transcript. Try again.");

    hooks.uploadStore.error = null;
    const upload = holdUpload();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    });

    expect(
      screen.queryByText("Couldn't attach the transcript. Try again."),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Attach" })).toBeDisabled();
    expect(bridge.upload).toHaveBeenCalledTimes(1);

    await act(async () => {
      upload.finish();
    });
    expect(uploads).toHaveLength(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the accepted partial transcript uploading", async () => {
    hooks.fetcher = fakeFetcher({ state: "partial" });
    const upload = holdUpload();
    renderPicker();
    fireEvent.click(selectChat());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach anyway" }));
    });

    expect(screen.getByRole("button", { name: "Attach" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await act(async () => {
      upload.finish();
    });
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

  it("attaches a drill-in tick from the body already on screen, without re-fetching", async () => {
    const base = fakeFetcher();
    const getMessage = vi.fn(base.getMessage);
    hooks.fetcher = { ...base, getMessage };
    hooks.messages = messagesResult({
      messages: [
        {
          chatId: MOCK_CHAT_ID,
          messageId: "1754000000000",
          senderName: "Grace Hopper",
          createdAt: "2026-08-10T09:15:00Z",
          editedAt: null,
          subject: null,
          text: "Works for me.",
          markers: [],
          sharedFiles: [],
          imageUrls: [],
          replyToId: null,
          deepLink: "https://example.invalid/m",
        },
      ],
    });
    renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "Open Product sync" }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select message from Grace Hopper",
      }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    });

    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(getMessage).not.toHaveBeenCalled();
    const text = await uploads[0][0].text();
    expect(text).toContain("Works for me.");
  });

  it("shows a shared file as a chip that opens the SharePoint preview", () => {
    hooks.messages = messagesResult({
      messages: [
        {
          chatId: MOCK_CHAT_ID,
          messageId: "1754000000000",
          senderName: "Max Token",
          createdAt: "2026-08-10T09:15:00Z",
          editedAt: null,
          subject: null,
          text: "check this PDF guys [attachment: multipage-test.pdf]",
          markers: [],
          replyToId: null,
          deepLink: "https://example.invalid/m",
          sharedFiles: [
            {
              attachmentId: "att-1",
              name: "multipage-test.pdf",
              contentUrl: "https://contoso.sharepoint.com/multipage-test.pdf",
            },
          ],
          imageUrls: [],
        },
      ],
    });
    const openSpy = vi
      .spyOn(window, "open")
      .mockReturnValue(null) as unknown as ReturnType<typeof vi.fn>;
    renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "Open Product sync" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Open multipage-test.pdf" }),
    );

    expect(openSpy).toHaveBeenCalledWith(
      "https://contoso.sharepoint.com/multipage-test.pdf",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("previews a shared file through our own token when the grant exists", async () => {
    const downloadSharedFile = vi.fn(() =>
      Promise.resolve({
        state: "ok" as const,
        content: {
          bytes: new TextEncoder().encode("pdf").buffer,
          contentType: "application/pdf",
        },
      }),
    );
    hooks.fileFetcher = { downloadSharedFile };
    hooks.messages = messagesResult({
      messages: [
        {
          chatId: MOCK_CHAT_ID,
          messageId: "1754000000000",
          senderName: "Max Token",
          createdAt: "2026-08-10T09:15:00Z",
          editedAt: null,
          subject: null,
          text: "check this PDF guys",
          markers: ["[attachment: multipage-test.pdf]"],
          replyToId: null,
          deepLink: "https://example.invalid/m",
          sharedFiles: [
            {
              attachmentId: "att-1",
              name: "multipage-test.pdf",
              contentUrl: "https://contoso.sharepoint.com/multipage-test.pdf",
            },
          ],
          imageUrls: [],
        },
      ],
    });
    // spyOn returns the previous test's spy when one exists; drop its calls.
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    openSpy.mockClear();
    URL.createObjectURL = vi.fn(() => "blob:preview");
    renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "Open Product sync" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Open multipage-test.pdf" }),
    );

    // The in-app preview modal takes the bytes; no tab, no SharePoint login.
    const preview = await screen.findByRole("dialog", {
      name: "Preview multipage-test.pdf",
    });
    expect(preview).toHaveTextContent("blob:preview");
    expect(downloadSharedFile).toHaveBeenCalledWith(
      "https://contoso.sharepoint.com/multipage-test.pdf",
      10 * 1024 * 1024,
      // Closing the dialog must be able to abort the transfer.
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("keeps the downloading chip's spinner out of the accessibility tree", () => {
    // Never resolves: the chip stays in its loading state for the assertions.
    hooks.fileFetcher = {
      downloadSharedFile: vi.fn(() => new Promise<never>(() => {})),
    };
    hooks.messages = messagesResult({
      messages: [
        {
          chatId: MOCK_CHAT_ID,
          messageId: "1754000000000",
          senderName: "Max Token",
          createdAt: "2026-08-10T09:15:00Z",
          editedAt: null,
          subject: null,
          text: "check this PDF guys",
          markers: ["[attachment: multipage-test.pdf]"],
          replyToId: null,
          deepLink: "https://example.invalid/m",
          sharedFiles: [
            {
              attachmentId: "att-1",
              name: "multipage-test.pdf",
              contentUrl: "https://contoso.sharepoint.com/multipage-test.pdf",
            },
          ],
          imageUrls: [],
        },
      ],
    });
    renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "Open Product sync" }));
    const chip = screen.getByRole("button", {
      name: "Open multipage-test.pdf",
    });
    fireEvent.click(chip);

    expect(chip).toHaveAttribute("aria-busy", "true");
    const spinner = chip.querySelector('[data-ui="spinner"]');
    expect(spinner).not.toBeNull();
    expect(spinner).toHaveAttribute("aria-hidden", "true");
    // The chip already names itself; a status region inside it would announce
    // "Loading..." as a second, competing name for the same control.
    expect(within(chip).queryByRole("status")).toBeNull();
    expect(chip).toHaveAccessibleName("Open multipage-test.pdf");
  });

  it("says a refused shared file was too large, not the wrong file type", async () => {
    const downloadSharedFile = vi.fn(() =>
      Promise.resolve({ state: "too-large" as const }),
    );
    hooks.fileFetcher = { downloadSharedFile };
    hooks.messages = messagesResult({
      messages: [
        {
          chatId: MOCK_CHAT_ID,
          messageId: "1754000000000",
          senderName: "Max Token",
          createdAt: "2026-08-10T09:15:00Z",
          editedAt: null,
          subject: null,
          text: "check this PDF guys",
          markers: ["[attachment: multipage-test.pdf]"],
          replyToId: null,
          deepLink: "https://example.invalid/m",
          sharedFiles: [
            {
              attachmentId: "att-1",
              name: "multipage-test.pdf",
              contentUrl: "https://contoso.sharepoint.com/multipage-test.pdf",
            },
          ],
          imageUrls: [],
        },
      ],
    });
    renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "Open Product sync" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Open multipage-test.pdf" }),
    );

    const preview = await screen.findByRole("dialog", {
      name: "Preview multipage-test.pdf",
    });
    expect(preview).toHaveTextContent("too large");
  });

  it("revokes the preview's blob url when the picker unmounts around it", async () => {
    const downloadSharedFile = vi.fn(() =>
      Promise.resolve({
        state: "ok" as const,
        content: {
          bytes: new TextEncoder().encode("pdf").buffer,
          contentType: "application/pdf",
        },
      }),
    );
    hooks.fileFetcher = { downloadSharedFile };
    hooks.messages = messagesResult({
      messages: [
        {
          chatId: MOCK_CHAT_ID,
          messageId: "1754000000000",
          senderName: "Max Token",
          createdAt: "2026-08-10T09:15:00Z",
          editedAt: null,
          subject: null,
          text: "check this PDF guys",
          markers: [],
          replyToId: null,
          deepLink: "https://example.invalid/m",
          sharedFiles: [
            {
              attachmentId: "att-1",
              name: "multipage-test.pdf",
              contentUrl: "https://contoso.sharepoint.com/multipage-test.pdf",
            },
          ],
          imageUrls: [],
        },
      ],
    });
    URL.createObjectURL = vi.fn(() => "blob:preview");
    const revoke = vi.fn();
    URL.revokeObjectURL = revoke;
    const view = renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "Open Product sync" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Open multipage-test.pdf" }),
    );
    await screen.findByRole("dialog", { name: "Preview multipage-test.pdf" });

    view.unmount();
    expect(revoke).toHaveBeenCalledWith("blob:preview");
  });

  it("uploads pasted images beside the transcript", async () => {
    const hosted = `https://graph.microsoft.com/v1.0/chats/x/messages/1/hostedContents/aWQ9/$value`;
    const base = fakeFetcher();
    hooks.fetcher = {
      ...base,
      pageChatBackwards: () =>
        Promise.resolve({
          messages: [
            mockGraphChatMessage({
              id: "a",
              body: {
                contentType: "html",
                content: `<p>see this</p><img src="${hosted}">`,
              },
            }),
          ],
          nextLink: null,
          truncated: false,
          oldestCreatedDateTime: "2026-03-03T09:14:00Z",
          state: "ok",
        }),
      getHostedContent: () =>
        Promise.resolve({
          bytes: new TextEncoder().encode("png-bytes").buffer,
          contentType: "image/png",
        }),
    };
    renderPicker();
    fireEvent.click(selectChat());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    });
    await waitFor(() => expect(uploads).toHaveLength(1));

    expect(uploads[0]).toHaveLength(2);
    const [transcript, image] = uploads[0];
    expect(transcript.name).toBe("teams-Product_sync.md");
    expect(image.name).toMatch(/^teams-img-[0-9a-f]{16}\.png$/);
    await expect(transcript.text()).resolves.toContain(
      `[image: ${image.name}]`,
    );
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

  it("attaches what the composer took when it took fewer files than were built", async () => {
    hooks.uploadLimit = 1;
    hooks.fetcher = {
      ...fakeFetcher(),
      pageChatBackwards: () =>
        Promise.resolve({
          messages: [
            mockGraphChatMessage({
              id: "a",
              body: {
                contentType: "html",
                content: `<p>see this</p><img src="https://graph.microsoft.com/v1.0/chats/x/messages/1/hostedContents/aWQ9/$value">`,
              },
            }),
          ],
          nextLink: null,
          truncated: false,
          oldestCreatedDateTime: "2026-03-03T09:14:00Z",
          state: "ok",
        }),
      getHostedContent: () =>
        Promise.resolve({
          bytes: new TextEncoder().encode("png-bytes").buffer,
          contentType: "image/png",
        }),
    };
    renderPicker();
    fireEvent.click(selectChat());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    });
    await waitFor(() => expect(records()).toHaveLength(1));

    expect(uploads[0]).toHaveLength(2);
    // The record claims exactly what was uploaded: the transcript alone.
    expect(records()).toEqual(["r1-0:teams-Product_sync.md:"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stages nothing when the dialog closes while the upload runs", async () => {
    const upload = holdUpload();
    renderPicker();
    fireEvent.click(selectChat());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    });
    await waitFor(() => expect(bridge.upload).toHaveBeenCalledTimes(1));
    // Busy, so a second click can't start another build.
    expect(screen.getByRole("button", { name: "Attach" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => upload.finish());

    expect(bridge.add).not.toHaveBeenCalled();
    expect(bridge.announce).not.toHaveBeenCalled();
    expect(records()).toEqual([]);
  });

  it("registers nothing when the upload fails", async () => {
    hooks.uploadStore.error = new Error("413");
    renderPicker();
    fireEvent.click(selectChat());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    });

    expect(
      await screen.findByText("Couldn't attach the transcript. Try again."),
    ).toBeInTheDocument();
    expect(records()).toEqual([]);
    expect(bridge.add).not.toHaveBeenCalled();
  });

  describe("edit selection (ERMAIN-1025)", () => {
    const picked = (messageId: string): TeamsChatSelection => ({
      kind: "message",
      ref: { kind: "chat", chatId: MOCK_CHAT_ID },
      messageId,
      conversationTitle: "Product sync",
      senderName: "Grace Hopper",
      createdAt: "2026-08-10T09:15:00Z",
      message: {
        id: messageId,
        senderName: "Grace Hopper",
        createdAt: "2026-08-10T09:15:00Z",
        text: `Message ${messageId}`,
      } as never,
    });
    const editRecord = (
      selections: TeamsChatSelection[],
      messageLimit = 200,
      excludedAssetNames: string[] = [],
    ): TeamsTranscriptRecord => ({
      lineage: "lineage-7",
      transcriptUploadId: "old-t",
      assetUploadIds: ["old-a"],
      assetNames: ["teams-img-0000000000000000.png"],
      excludedAssetNames,
      file: new File(["#"], "teams-Product_sync.md"),
      selections,
      messageLimit,
    });
    const whole: TeamsChatSelection = {
      kind: "conversation",
      ref: { kind: "chat", chatId: MOCK_CHAT_ID },
      title: "Product sync",
    };

    it("reopens with the transcript's selection, its window and Update", () => {
      renderPicker({
        open: "edit",
        edit: editRecord([picked("m1"), picked("m2"), picked("m3")], 400),
      });

      expect(screen.getByText("3 picked messages")).toBeInTheDocument();
      // Part of the chat is in the transcript: neither ticked nor empty.
      expect(selectChat()).toBePartiallyChecked();
      expect(
        screen.getByText("Whole chats add the last 400 messages."),
      ).toBeInTheDocument();
      expect(screen.getByText("3 items selected")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Update" })).toBeEnabled();
      expect(
        screen.queryByRole("button", { name: "Attach" }),
      ).not.toBeInTheDocument();
    });

    it("rebuilds on Update and swaps the record in place, keeping its lineage", async () => {
      const base = fakeFetcher();
      const pageChatBackwards = vi.fn(base.pageChatBackwards);
      hooks.fetcher = { ...base, pageChatBackwards };
      const previous = editRecord([whole]);
      renderPicker({ open: "edit", edit: previous });
      expect(selectChat()).toBeChecked();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Update" }));
      });
      await waitFor(() => expect(bridge.replace).toHaveBeenCalledTimes(1));

      expect(pageChatBackwards).toHaveBeenCalledTimes(1);
      expect(bridge.replace).toHaveBeenCalledWith(previous, [
        { id: "r1-0", filename: "teams-Product_sync.md" },
      ]);
      expect(bridge.add).not.toHaveBeenCalled();
      expect(
        screen
          .getByTestId("attached-transcripts")
          .querySelector("li")
          ?.getAttribute("data-lineage"),
      ).toBe("lineage-7");
      expect(bridge.announce).toHaveBeenCalledWith("Teams transcript updated.");
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("takes the transcript out when Update finds nothing ticked", async () => {
      renderPicker({ open: null });
      // Attach first, so there is a record to edit.
      fireEvent.click(screen.getByText("open picker"));
      fireEvent.click(selectChat());
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Attach" }));
      });
      await waitFor(() => expect(records()).toHaveLength(1));
      vi.mocked(bridge.focusComposer).mockClear();

      fireEvent.click(screen.getByText("edit transcript"));
      fireEvent.click(selectChat());
      expect(
        screen.getByText("Nothing selected: Update removes the transcript."),
      ).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Update" }));
      });

      expect(bridge.remove).toHaveBeenCalledWith(["r1-0"]);
      expect(records()).toEqual([]);
      expect(bridge.announce).toHaveBeenLastCalledWith(
        "Teams transcript removed.",
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(bridge.focusComposer).toHaveBeenCalled();
    });

    it("takes a chat's picked messages out when its mixed row is unticked", () => {
      renderPicker({
        open: "edit",
        edit: editRecord([
          picked("m1"),
          picked("m2"),
          {
            kind: "conversation",
            ref: { kind: "chat", chatId: "19:design-review" },
            title: "Design review",
          },
        ]),
      });
      expect(selectChat()).toBePartiallyChecked();

      fireEvent.click(selectChat());

      expect(selectChat()).not.toBePartiallyChecked();
      expect(selectChat()).not.toBeChecked();
      expect(screen.queryByText("2 picked messages")).toBeNull();
      // The other conversation stays as it was.
      expect(screen.getByText("1 item selected")).toBeInTheDocument();
    });

    it("drops the Update when the dialog closes while its upload runs", async () => {
      const previous = editRecord([whole]);
      const upload = holdUpload();
      renderPicker({ open: "edit", edit: previous });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Update" }));
      });
      await waitFor(() => expect(bridge.upload).toHaveBeenCalledTimes(1));
      expect(screen.getByRole("button", { name: "Update" })).toBeDisabled();

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await act(async () => upload.finish());

      // Not a second transcript next to the first: nothing changed at all.
      expect(bridge.add).not.toHaveBeenCalled();
      expect(bridge.replace).not.toHaveBeenCalled();
      expect(bridge.announce).not.toHaveBeenCalled();
      expect(records()).toEqual([]);
    });

    it("keeps a file the user removed out of the update", async () => {
      hooks.fetcher = imageFetcher();
      renderPicker({ open: null });
      fireEvent.click(screen.getByText("open picker"));
      fireEvent.click(selectChat());
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Attach" }));
      });
      await waitFor(() => expect(records()).toHaveLength(1));
      const image = uploads[0][1].name;
      cleanup();

      // As the detail's remove leaves it: the image noted on the record.
      renderPicker({
        open: "edit",
        edit: editRecord([whole], 200, [image]),
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Update" }));
      });
      await waitFor(() => expect(bridge.replace).toHaveBeenCalledTimes(1));

      expect(uploads[1].map((file) => file.name)).toEqual([
        "teams-Product_sync.md",
      ]);
    });

    it("changes nothing on Cancel and forgets the reopened selection", () => {
      renderPicker({ open: "edit", edit: editRecord([whole]) });
      fireEvent.click(selectChat());
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(bridge.replace).not.toHaveBeenCalled();
      expect(bridge.remove).not.toHaveBeenCalled();

      fireEvent.click(screen.getByText("open picker"));
      expect(selectChat()).not.toBeChecked();
      expect(screen.getByRole("button", { name: "Attach" })).toBeDisabled();
    });

    it("keeps the old transcript when the Update's upload fails", async () => {
      hooks.uploadStore.error = new Error("413");
      renderPicker({ open: "edit", edit: editRecord([whole]) });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Update" }));
      });

      expect(
        await screen.findByText("Couldn't attach the transcript. Try again."),
      ).toBeInTheDocument();
      expect(bridge.replace).not.toHaveBeenCalled();
      expect(bridge.remove).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Update" })).toBeEnabled();
    });

    it("replaces the old transcript with a partial one on Attach anyway", async () => {
      hooks.fetcher = fakeFetcher({ state: "partial" });
      const previous = editRecord([whole]);
      renderPicker({ open: "edit", edit: previous });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Update" }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Attach anyway" }));
      });

      await waitFor(() => expect(bridge.replace).toHaveBeenCalledTimes(1));
      expect(vi.mocked(bridge.replace).mock.calls[0][0]).toBe(previous);
    });
  });

  describe("channel search hits", () => {
    const CHANNEL_HIT = {
      ref: { kind: "channel" as const, teamId: "t1", channelId: "c1" },
      webLink: null,
      messageId: "1786384303161",
      senderName: "Max Token",
      createdAt: "2026-08-10T17:51:44Z",
      summary: "hey <c0>folks</c0> whats up?",
    };

    function arrangeChannelHit(
      probeMessage?: TeamsChannelFetcher["probeMessage"],
    ) {
      hooks.search = searchResult({ hits: [CHANNEL_HIT] });
      hooks.channelList = channelListResult({
        channels: parseTeamChannels({ id: "t1", displayName: "Erato Labs" }, [
          { id: "c1", displayName: "Test Channel 1" },
        ]),
      });
      if (probeMessage) {
        hooks.channelFetcher = fakeChannelFetcher({ probeMessage });
      }
    }

    const hitCheckbox = () =>
      screen.findByRole("checkbox", { name: "Select message from Max Token" });

    async function searchForHit() {
      renderPicker();
      fireEvent.change(
        screen.getByLabelText("Filter Teams chats or search messages"),
        { target: { value: "folks" } },
      );
      return hitCheckbox();
    }

    it("probes on the first tick and selects the hit once it proves a root", async () => {
      const probeMessage = vi.fn(() =>
        Promise.resolve({
          message: mockGraphChatMessage({ id: CHANNEL_HIT.messageId }),
          status: 200,
        }),
      );
      arrangeChannelHit(probeMessage);
      const checkbox = await searchForHit();

      await act(async () => {
        fireEvent.click(checkbox);
      });

      expect(probeMessage).toHaveBeenCalledWith(
        "t1",
        "c1",
        CHANNEL_HIT.messageId,
        expect.anything(),
      );
      await waitFor(() => expect(checkbox).toBeChecked());
    });

    it("turns a reply hit into a pointer at its channel instead of a doomed attach", async () => {
      arrangeChannelHit(() => Promise.resolve({ message: null, status: 404 }));
      const checkbox = await searchForHit();

      await act(async () => {
        fireEvent.click(checkbox);
      });

      expect(
        await screen.findByText(
          "A reply can't be attached from search — open the channel to pick it.",
        ),
      ).toBeInTheDocument();
      expect(checkbox).not.toBeChecked();
      expect(checkbox).toBeDisabled();

      // The remedy is one click away: the row opens the channel drill-in.
      fireEvent.click(
        screen.getByRole("button", { name: "Open Test Channel 1" }),
      );
      expect(
        screen.getByText("No messages in this channel yet."),
      ).toBeInTheDocument();
    });

    it("keeps a transient probe failure retryable", async () => {
      const probeMessage = vi.fn(() =>
        Promise.resolve({ message: null, status: 0 }),
      );
      arrangeChannelHit(probeMessage);
      const checkbox = await searchForHit();

      await act(async () => {
        fireEvent.click(checkbox);
      });
      expect(
        await screen.findByText(
          "Couldn't check this message. Select it again to retry.",
        ),
      ).toBeInTheDocument();
      expect(checkbox).toBeEnabled();

      await act(async () => {
        fireEvent.click(checkbox);
      });
      expect(probeMessage).toHaveBeenCalledTimes(2);
    });

    it("says why a channel hit is inert when channel access is missing", async () => {
      arrangeChannelHit();
      const checkbox = await searchForHit();

      expect(checkbox).toBeDisabled();
      expect(
        screen.getByText(
          "Channel messages can't be attached — channel access hasn't been granted.",
        ),
      ).toBeInTheDocument();
    });
  });
});
