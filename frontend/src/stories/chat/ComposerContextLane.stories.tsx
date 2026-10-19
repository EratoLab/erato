import { action } from "@storybook/addon-actions";
import { useEffect, useMemo, useState } from "react";

import { ChatInput } from "@/components/ui/Chat/ChatInput";
import { ComposerContextLane } from "@/components/ui/Chat/ComposerContext/ComposerContextLane";
import { GroupedFileAttachmentsPreview } from "@/components/ui/FileUpload/GroupedFileAttachmentsPreview";
import { componentRegistry } from "@/config/componentRegistry";

import {
  AnnouncementLog,
  noop,
  pane,
  stagedFile,
  useResolved,
} from "./composerContextStoryKit";

import type {
  ComposerContextChipFaceProps,
  ComposerContextItem,
  ComposerNotice,
} from "@/components/ui/Chat/ComposerContext/types";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";

/** A stand-in for the composer shell, for stories that show the lane alone. */
const Shell = ({ children }: { children: ReactNode }) => (
  <div className="chat-input-shell-geometry chat-input-shell-skin flex flex-col border border-[var(--theme-border-chat-input)]">
    {children}
  </div>
);

const fiveFiles = [
  stagedFile("f1", "supply-plan-q3.pdf"),
  stagedFile("f2", "pricing.xlsx"),
  stagedFile("f3", "contract-v3.pdf"),
  stagedFile("f4", "meeting-notes.docx"),
  stagedFile("f5", "risk-register.pdf"),
];

const twoFiles = fiveFiles.slice(0, 2);

const selection: ComposerContextItem = {
  id: "selection",
  kind: "word.selection",
  origin: "ambient",
  dismissScope: "selection",
  state: "included",
  label: "“The Supplier shall deliver within 30 days”",
  meta: "Selected passage",
  icon: "selection",
  onRemove: noop,
  onRestore: noop,
  removeLabel: "Dismiss selection",
  restoreLabel: "Use this selection",
};

const documentItem: ComposerContextItem = {
  id: "document",
  kind: "word.document",
  origin: "ambient",
  dismissScope: "chat",
  state: "included",
  label: "Supply agreement",
  meta: "Whole document",
  icon: "document",
  onRemove: noop,
  onRestore: noop,
  removeLabel: "Don't include this document",
  detail: {
    title: "Supply agreement",
    render: () => (
      <div className="flex flex-col gap-2">
        <p>
          The whole document is sent with your message: 14 pages, 6,120 words.
        </p>
        <p className="text-theme-fg-secondary">
          Select a passage in Word to send only that.
        </p>
      </div>
    ),
  },
};

const allStates: ComposerContextItem[] = [
  selection,
  {
    ...documentItem,
    state: "superseded",
    meta: "Replaced by selection",
    detail: {
      title: "Supply agreement",
      render: () => <p>The selection is sent instead of the document.</p>,
      actions: [{ id: "instead", label: "Send this instead", onSelect: noop }],
    },
  },
  {
    id: "draft",
    kind: "outlook.draft",
    origin: "ambient",
    dismissScope: "item",
    state: "suggested",
    label: "Your draft",
    icon: "draft",
    onRestore: noop,
    restoreLabel: "Include draft",
  },
  {
    id: "reading",
    kind: "word.document",
    origin: "ambient",
    dismissScope: "chat",
    state: "loading",
    label: "Supply agreement",
    meta: "Reading document…",
    icon: "document",
    onRemove: noop,
  },
  {
    id: "error",
    kind: "outlook.thread",
    origin: "ambient",
    dismissScope: "item",
    state: "error",
    label: "Email thread",
    meta: "Couldn't load the email thread",
    icon: "mail",
    onRemove: noop,
  },
  {
    id: "comments",
    kind: "word.comments",
    origin: "ambient",
    dismissScope: "message",
    state: "attention",
    label: "Comments",
    meta: "Cursor is in 3 comments · Choose one",
    icon: "comments",
    onRemove: noop,
    detail: {
      title: "Choose a comment",
      render: () => <p>Three comments overlap the cursor.</p>,
    },
  },
  {
    id: "dropping",
    kind: "outlook.drop",
    origin: "user",
    state: "loading",
    label: "Re: Offsite agenda",
    meta: "Adding 3 attachments…",
    icon: "mail",
    locked: true,
    lockReason: "Wait until the email is added",
  },
  {
    id: "transcript",
    kind: "teams.transcript",
    origin: "user",
    state: "included",
    label: "Weekly product sync",
    meta: "42 messages",
    icon: "chats",
    locked: true,
    lockReason: "Preparing the transcript",
    onRemove: noop,
  },
];

const meta: Meta = {
  title: "Chat/ComposerContextLane",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Host context as chips inside the composer, before staged files. Each chip renders the state its host resolved from the send; (x) and + are always visible, and Enter opens a chip's detail.",
      },
    },
  },
};

export default meta;
type Story = StoryObj;

const LaneAlone = ({ seed }: { seed: ComposerContextItem[] }) => {
  const items = useResolved(seed);
  return (
    <>
      <Shell>
        <ComposerContextLane items={items} />
      </Shell>
      <AnnouncementLog />
    </>
  );
};

export const AllStates: Story = {
  decorators: [pane(340)],
  render: () => <LaneAlone seed={allStates} />,
};

export const LongLabels: Story = {
  decorators: [pane(340)],
  render: () => (
    <LaneAlone
      seed={[
        {
          ...documentItem,
          label:
            "FY2026 enterprise rollout supporting documentation and implementation notes, final review v12",
          meta: "Whole document, 48 pages, last saved by Maya Krüger",
        },
        {
          ...selection,
          meta: undefined,
          state: "suggested",
          label:
            "“Notwithstanding anything to the contrary in this Agreement, the Supplier shall…”",
        },
      ]}
    />
  ),
};

const ComposerWith = ({
  seed,
  files = [],
  notice,
  churn = false,
}: {
  seed: ComposerContextItem[];
  files?: FileUploadItem[];
  notice?: ComposerNotice | null;
  churn?: boolean;
}) => {
  const resolved = useResolved(seed);
  const [selectionCount, setSelectionCount] = useState(0);
  const items = useMemo(
    () =>
      selectionCount === 0
        ? resolved
        : resolved.map((item) =>
            item.id === "selection" && item.state === "included"
              ? {
                  ...item,
                  label: `“A new selection, take ${selectionCount}”`,
                }
              : item,
          ),
    [resolved, selectionCount],
  );
  return (
    <>
      <ChatInput
        onSendMessage={action("onSendMessage")}
        handleFileAttachments={action("handleFileAttachments")}
        initialFiles={files}
        contextItems={items}
        composerNotice={notice}
        maxFiles={20}
        showControls
      />
      {churn ? (
        <button
          type="button"
          className="mt-3 rounded border border-theme-border px-2 py-1 text-xs"
          onClick={() => setSelectionCount((count) => count + 1)}
        >
          Change selection
        </button>
      ) : null}
      <AnnouncementLog />
    </>
  );
};

export const Interactive: Story = {
  decorators: [pane(340)],
  render: () => (
    <ComposerWith
      churn
      seed={[
        selection,
        documentItem,
        {
          id: "drop-1",
          kind: "outlook.drop",
          origin: "user",
          state: "included",
          label: "Re: Offsite agenda",
          meta: "Email, 2 attachments",
          icon: "mail",
          onRemove: noop,
        },
        {
          id: "drop-2",
          kind: "outlook.drop",
          origin: "user",
          state: "included",
          label: "Budget follow-up",
          meta: "Email",
          icon: "mail",
          onRemove: noop,
        },
      ]}
    />
  ),
};

const busySeed: ComposerContextItem[] = [
  selection,
  { ...documentItem, state: "superseded", meta: "Replaced by selection" },
  {
    id: "comment",
    kind: "word.comment",
    origin: "ambient",
    dismissScope: "message",
    state: "included",
    label: "Comment by Maya Krüger",
    meta: "At your cursor",
    icon: "comment",
    onRemove: noop,
    onRestore: noop,
  },
  {
    id: "open-comments",
    kind: "word.comments",
    origin: "ambient",
    dismissScope: "message",
    state: "suggested",
    label: "Open comments (4)",
    icon: "comments",
    onRestore: noop,
  },
  ...[
    "Re: Offsite agenda",
    "Budget follow-up",
    "Vendor shortlist",
    "Q3 plan",
  ].map(
    (label, index): ComposerContextItem => ({
      id: `drop-${index}`,
      kind: "outlook.drop",
      origin: "user",
      state: "included",
      label,
      meta: "Email",
      icon: "mail",
      onRemove: noop,
    }),
  ),
];

export const BusyLane: Story = {
  decorators: [pane(340)],
  render: () => <ComposerWith seed={busySeed} files={fiveFiles} />,
};

const threeItems = [selection, documentItem, allStates[2]];
const readingNotice: ComposerNotice = {
  id: "reading",
  tone: "info",
  busy: true,
  text: "Reading the document…",
  actions: [{ id: "skip", label: "Send without it", onSelect: noop }],
};

export const InChatInput: Story = {
  decorators: [pane(340)],
  render: () => (
    <ComposerWith seed={threeItems} files={twoFiles} notice={readingNotice} />
  ),
};

export const InChatInputWide: Story = {
  decorators: [pane(1280)],
  render: () => (
    <ComposerWith seed={threeItems} files={twoFiles} notice={readingNotice} />
  ),
};

/** A host that opted in but has nothing to show yet: no extra space. */
export const NoItemsYet: Story = {
  decorators: [pane(340)],
  render: () => <ComposerWith seed={[]} notice={null} />,
};

const THREAD_MESSAGES = [
  ["m1", "Maya Krüger", "Mon 09:12 · Agenda draft"],
  ["m2", "Jonas Weber", "Mon 11:40 · Re: Agenda draft"],
  ["m3", "Maya Krüger", "Tue 08:05 · Re: Re: Agenda draft"],
  ["m4", "Lena Hoffmann", "Tue 10:31 · Re: Re: Agenda draft"],
  ["m5", "Jonas Weber", "Tue 14:02 · Room booking"],
  ["m6", "Maya Krüger", "Wed 08:45 · Catering"],
  ["m7", "Lena Hoffmann", "Wed 16:20 · Travel"],
  ["m8", "Jonas Weber", "Thu 09:05 · Final agenda"],
] as const;

const ThreadChecklist = ({ count = 3 }: { count?: number }) => {
  const [included, setIncluded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      THREAD_MESSAGES.slice(0, count).map(([id], index) => [id, index !== 2]),
    ),
  );
  const toggle = (id: string) =>
    setIncluded((current) => ({ ...current, [id]: !current[id] }));
  const message = (id: string, label: string, sublabel: string) => ({
    kind: "threadMessageGroup" as const,
    id,
    label,
    sublabel,
    selected: included[id],
    onToggle: () => toggle(id),
    defaultCollapsed: true,
    attachments: [],
  });
  return (
    <GroupedFileAttachmentsPreview
      groups={[
        {
          id: "thread",
          label: "Re: Offsite agenda",
          metaLabel: `${count} messages`,
          items: THREAD_MESSAGES.slice(0, count).map(([id, label, sublabel]) =>
            message(id, label, sublabel),
          ),
        },
      ]}
    />
  );
};

const detailSeed: ComposerContextItem[] = [
  {
    ...selection,
    detail: {
      title: "Selected passage",
      render: () => <p>{selection.label}</p>,
    },
  },
  documentItem,
  {
    id: "thread",
    kind: "outlook.thread",
    origin: "ambient",
    dismissScope: "item",
    state: "included",
    label: "Email thread",
    meta: "2 of 3 messages",
    icon: "mail",
    onRemove: noop,
    onRestore: noop,
    detail: { title: "Re: Offsite agenda", render: () => <ThreadChecklist /> },
  },
];

export const DetailSheet: Story = {
  decorators: [pane(340)],
  render: () => <ComposerWith seed={detailSeed} files={twoFiles} />,
};

const longDetailSeed: ComposerContextItem[] = [
  {
    ...detailSeed[2],
    meta: "7 of 8 messages",
    detail: {
      title: "Re: Offsite agenda",
      render: () => <ThreadChecklist count={8} />,
      actions: [{ id: "all", label: "Include every message", onSelect: noop }],
    },
  },
];

// A detail taller than the sheet: its actions stay pinned while the body
// scrolls.
export const DetailSheetLong: Story = {
  decorators: [pane(340)],
  render: () => <ComposerWith seed={longDetailSeed} />,
};

export const DetailPopover: Story = {
  decorators: [pane(1280)],
  render: () => (
    <div style={{ paddingTop: 480 }}>
      <ComposerWith seed={detailSeed} files={twoFiles} />
    </div>
  ),
};

const NoticeCycle = () => {
  const notices: ComposerNotice[] = [
    readingNotice,
    {
      id: "choose",
      tone: "warning",
      text: "Your cursor is in 3 comments. Choose one to send it with your message.",
      actions: [{ id: "choose", label: "Choose a comment", onSelect: noop }],
    },
    {
      id: "selfail",
      tone: "error",
      text: "Couldn't read the selection. Your message was not sent.",
      actions: [{ id: "retry", label: "Try again", onSelect: noop }],
      onDismiss: noop,
    },
  ];
  return (
    <div className="flex flex-col gap-6">
      {notices.map((notice) => (
        <ChatInput
          key={notice.id}
          onSendMessage={action("onSendMessage")}
          contextItems={[documentItem]}
          composerNotice={notice}
          showControls
        />
      ))}
    </div>
  );
};

export const Notices: Story = {
  decorators: [pane(340)],
  render: () => <NoticeCycle />,
};

const SampleKitFace = ({ item, icon, meta }: ComposerContextChipFaceProps) => (
  <span
    data-testid="sample-kit-face"
    className="flex min-w-0 flex-1 items-center gap-2 font-mono text-xs"
  >
    {icon}
    <span className="truncate uppercase tracking-wide">{item.label}</span>
    {meta ? <span className="truncate opacity-80">{`[${meta}]`}</span> : null}
  </span>
);

/** Installs the face before the lane renders and puts the host's back after. */
const WithKitFace = ({ children }: { children: ReactNode }) => {
  const [previous] = useState(() => {
    const host = componentRegistry.ComposerContextChipFace;
    componentRegistry.ComposerContextChipFace = SampleKitFace;
    return host;
  });
  useEffect(
    () => () => {
      componentRegistry.ComposerContextChipFace = previous;
    },
    [previous],
  );
  return children;
};

export const KitFace: Story = {
  decorators: [
    pane(340),
    (Story) => (
      <WithKitFace>
        <Story />
      </WithKitFace>
    ),
  ],
  render: () => <LaneAlone seed={allStates.slice(0, 6)} />,
};
