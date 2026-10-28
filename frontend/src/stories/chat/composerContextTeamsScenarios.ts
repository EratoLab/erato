/*
 * The Teams stories' data and seeds. No imports: the add-in's parity test
 * (office-addin/src/teams/utils/__tests__/teamsStoryParity.test.ts) runs the
 * add-in's send preview and the library's chip hook on these same scenarios
 * and writes the chips each story has to draw, which the Storybook spec then
 * holds the stories to.
 *
 * The conversations are the target prototype's: Product sync, Design review
 * in the Platform Team and four messages picked from a chat with Grace Hopper.
 */

export const KB = 1024;
export const MB = 1024 * KB;
export const TEAMS_VIEWER = "Sam Lee";
const EXPORTED_AT = "2026-10-14T15:30:00Z";

export type TeamsStoryConversationKey =
  | "product"
  | "productPartial"
  | "design"
  | "grace"
  | "graceWithImage"
  | "budget";

type ConversationRef =
  | { kind: "chat"; chatId: string }
  | { kind: "channel"; teamId: string; channelId: string };

interface StoryAsset {
  key: string;
  /** The minted upload name, which is also the index's join key. */
  uploadName: string;
  /** As Teams named it; null for a pasted image. */
  displayName: string | null;
  kind: "image" | "file";
  size: number;
  /** The message that carries it, by position in the conversation. */
  at: number;
}

interface StoryMessage {
  sender: string;
  createdAt: string;
  text: string;
}

interface StoryConversation {
  kind: "chat" | "channel";
  ref: ConversationRef;
  title: string;
  teamName: string | null;
  selection: "whole-chat" | "messages";
  limit: number | null;
  truncated: boolean;
  skippedCount: number;
  participants: string[];
  messages: StoryMessage[];
  assets: StoryAsset[];
}

const LINES = [
  "Let's lock the Q1 order on Thursday.",
  "I moved the onboarding work after the billing fix.",
  "Can we get the numbers for the support tier?",
  "Draft roadmap is up, comments welcome.",
  "The dashboard looks off for EU users.",
  "Agreed, billing first.",
  "Who owns the migration runbook?",
  "I'll take it.",
  "Design wants one more review round.",
  "Shipping notes are in the wiki.",
];
const SENDERS = ["Ada Lovelace", "Grace Hopper", "Alan Turing", TEAMS_VIEWER];

/** `count` messages spread evenly from `from` to `to`, oldest first. */
function wholeConversation(
  count: number,
  from: string,
  to: string,
): StoryMessage[] {
  const start = Date.parse(from);
  const end = Date.parse(to);
  return Array.from({ length: count }, (_, position) => ({
    sender: SENDERS[position % SENDERS.length],
    createdAt: new Date(
      start + Math.round(((end - start) * position) / (count - 1)),
    ).toISOString(),
    text: LINES[position % LINES.length],
  }));
}

const asset = (
  key: string,
  uploadName: string,
  displayName: string | null,
  size: number,
  at: number,
): StoryAsset => ({
  key,
  uploadName,
  displayName,
  kind: displayName === null ? "image" : "file",
  size,
  at,
});

const ROADMAP = asset(
  "roadmap",
  "teams-file-3f9a1c2e-roadmap-q1.pdf",
  "roadmap-q1.pdf",
  Math.round(1.1 * MB),
  37,
);
const DASHBOARD = asset(
  "dashboard",
  "teams-file-8b04d7e1-dashboard-screenshot.png",
  "dashboard-screenshot.png",
  240 * KB,
  81,
);

const PRODUCT_SYNC_REF: ConversationRef = {
  kind: "chat",
  chatId: "19:product-sync@thread.v2",
};
const GRACE_REF: ConversationRef = {
  kind: "chat",
  chatId: "19:grace_sam@unq.gbl.spaces",
};
const PRODUCT_PARTICIPANTS = [
  "Ada Lovelace",
  "Grace Hopper",
  "Alan Turing",
  TEAMS_VIEWER,
];

const GRACE_PICKED: StoryMessage[] = [
  {
    sender: "Grace Hopper",
    createdAt: "2026-10-10T14:20:00Z",
    text: "The vendor wants a decision on the support tier by the end of the month.",
  },
  {
    sender: TEAMS_VIEWER,
    createdAt: "2026-10-11T06:45:00Z",
    text: "Which tiers are on the table?",
  },
  {
    sender: "Grace Hopper",
    createdAt: "2026-10-11T07:10:00Z",
    text: "Standard and Premium. Premium adds weekend cover.",
  },
  {
    sender: "Grace Hopper",
    createdAt: "2026-10-12T09:00:00Z",
    text: "Premium is 18% more per year.",
  },
];

const grace = (assets: StoryAsset[]): StoryConversation => ({
  kind: "chat",
  ref: GRACE_REF,
  title: "Grace Hopper",
  teamName: null,
  selection: "messages",
  limit: null,
  truncated: false,
  skippedCount: 0,
  participants: ["Grace Hopper", TEAMS_VIEWER],
  messages: GRACE_PICKED,
  assets,
});

export const TEAMS_STORY_CONVERSATIONS: Record<
  TeamsStoryConversationKey,
  StoryConversation
> = {
  product: {
    kind: "chat",
    ref: PRODUCT_SYNC_REF,
    title: "Product sync",
    teamName: null,
    selection: "whole-chat",
    limit: 200,
    truncated: false,
    skippedCount: 0,
    participants: PRODUCT_PARTICIPANTS,
    messages: wholeConversation(
      120,
      "2026-10-01T07:30:00Z",
      "2026-10-14T15:10:00Z",
    ),
    assets: [ROADMAP, DASHBOARD],
  },
  productPartial: {
    kind: "chat",
    ref: PRODUCT_SYNC_REF,
    title: "Product sync",
    teamName: null,
    selection: "whole-chat",
    limit: 100,
    truncated: true,
    skippedCount: 2,
    participants: PRODUCT_PARTICIPANTS,
    messages: wholeConversation(
      100,
      "2026-10-03T09:00:00Z",
      "2026-10-14T15:10:00Z",
    ),
    assets: [{ ...ROADMAP, at: 20 }],
  },
  design: {
    kind: "channel",
    ref: {
      kind: "channel",
      teamId: "team-platform",
      channelId: "19:design-review@thread.tacv2",
    },
    title: "Design review",
    teamName: "Platform Team",
    selection: "whole-chat",
    limit: 200,
    truncated: false,
    skippedCount: 0,
    participants: ["Ada Lovelace", "Linus Torvalds", TEAMS_VIEWER],
    messages: wholeConversation(
      116,
      "2026-09-22T08:00:00Z",
      "2026-10-13T16:45:00Z",
    ),
    assets: [
      asset(
        "wireframes",
        "teams-file-c51e0a94-wireframes-v2.pdf",
        "wireframes-v2.pdf",
        Math.round(3.4 * MB),
        60,
      ),
    ],
  },
  grace: grace([]),
  graceWithImage: grace([
    asset("image", "teams-img-5ac1e9f0b2d47386.png", null, 180 * KB, 2),
  ]),
  budget: {
    kind: "chat",
    ref: { kind: "chat", chatId: "19:budget@thread.v2" },
    title: "Budget 2027",
    teamName: null,
    selection: "whole-chat",
    limit: 200,
    truncated: false,
    skippedCount: 0,
    participants: ["Ada Lovelace", "Linus Torvalds", TEAMS_VIEWER],
    messages: wholeConversation(
      18,
      "2026-10-05T08:00:00Z",
      "2026-10-09T16:00:00Z",
    ),
    assets: [
      asset(
        "budget",
        "teams-file-77d2e6b3-budget-2027.xlsx",
        "budget-2027.xlsx",
        64 * KB,
        12,
      ),
    ],
  },
};

/** What the stand-in picker lists, in the order the Teams picker would. */
export const TEAMS_STORY_PICKER_CHOICES: TeamsStoryConversationKey[] = [
  "product",
  "design",
  "grace",
  "budget",
];

/** One transcript the composer holds: the picker's record of it. */
export interface TeamsStoryTranscript {
  /** The chip's identity, kept across "Edit selection". */
  lineage: string;
  /** The transcript's upload id; its assets' ids derive from it. */
  uploadId: string;
  conversations: TeamsStoryConversationKey[];
  /** No index block: the transcript still sends, its chip can't name it. */
  unreadable?: boolean;
  /** Its index is read only when the story says so. */
  slowRead?: boolean;
  /** Assets (by key) the user already removed from the composer. */
  removedAssets?: string[];
  /** Assets (by key) handed over that the composer did not take, e.g. past its file limit. */
  notAttachedAssets?: string[];
}

export interface TeamsStoryUserFile {
  id: string;
  filename: string;
  size: number;
}

export interface TeamsStorySeed {
  transcripts: TeamsStoryTranscript[];
  userFiles?: TeamsStoryUserFile[];
  /** False where the picker can't run: the detail offers no "Edit selection". */
  picker?: boolean;
  /** The composer is locked (an upload, a recording, `disabled`). */
  locked?: boolean;
}

/** An upload the composer holds: what `FileUploadItem` carries, plus its size. */
export interface TeamsStoryUpload {
  id: string;
  filename: string;
  size: number;
}

export function teamsStoryFileName(
  conversations: readonly TeamsStoryConversationKey[],
): string {
  if (conversations.length === 1) {
    const title = TEAMS_STORY_CONVERSATIONS[conversations[0]].title;
    return `teams-${title.replace(/\s+/g, "_")}.md`;
  }
  return `teams-chats-${conversations.length}.md`;
}

const assetsOf = (transcript: TeamsStoryTranscript) =>
  transcript.conversations.flatMap(
    (key) => TEAMS_STORY_CONVERSATIONS[key].assets,
  );

const assetUploadId = (transcript: TeamsStoryTranscript, key: string) =>
  `${transcript.uploadId}:${key}`;

/** The transcript upload, then its assets: the order the picker uploads them. */
export function teamsStoryTranscriptUploads(transcript: TeamsStoryTranscript): {
  transcript: TeamsStoryUpload;
  assets: TeamsStoryUpload[];
} {
  return {
    transcript: {
      id: transcript.uploadId,
      filename: teamsStoryFileName(transcript.conversations),
      size: 0,
    },
    assets: assetsOf(transcript).map((entry) => ({
      id: assetUploadId(transcript, entry.key),
      filename: entry.uploadName,
      size: entry.size,
    })),
  };
}

/** Upload names of the assets the user removed from a transcript. */
export function teamsStoryRemovedNames(
  transcript: TeamsStoryTranscript,
): string[] {
  const removed = new Set(transcript.removedAssets ?? []);
  return assetsOf(transcript)
    .filter((entry) => removed.has(entry.key))
    .map((entry) => entry.uploadName);
}

/** What the composer has staged for a seed, in staged order. */
export function teamsStoryStaged(seed: TeamsStorySeed): TeamsStoryUpload[] {
  return [
    ...seed.transcripts.flatMap((transcript) => {
      const uploads = teamsStoryTranscriptUploads(transcript);
      const removed = new Set(
        [
          ...(transcript.removedAssets ?? []),
          ...(transcript.notAttachedAssets ?? []),
        ].map((key) => assetUploadId(transcript, key)),
      );
      return [
        uploads.transcript,
        ...uploads.assets.filter((upload) => !removed.has(upload.id)),
      ];
    }),
    ...(seed.userFiles ?? []),
  ];
}

/** The transcript "Update" builds: same lineage, new uploads. */
export function teamsStoryUpdate(
  transcript: TeamsStoryTranscript,
  conversations: TeamsStoryConversationKey[],
  version: number,
): TeamsStoryTranscript {
  return {
    lineage: transcript.lineage,
    uploadId: `${transcript.lineage}-v${version}`,
    conversations,
  };
}

/**
 * The transcript's index block as the picker writes it. The caller passes the
 * format's marker and version, so the stories and the parity test read them
 * from the library rather than from a copy here.
 */
export function teamsStoryIndex(
  transcript: TeamsStoryTranscript,
  version: number,
) {
  const sections = transcript.conversations.map((key) => {
    const conversation = TEAMS_STORY_CONVERSATIONS[key];
    return {
      kind: conversation.kind,
      ref: conversation.ref,
      title: conversation.title,
      teamName: conversation.teamName,
      selection: conversation.selection,
      limit: conversation.limit,
      truncated: conversation.truncated,
      skippedCount: conversation.skippedCount,
      window: {
        from: conversation.messages[0]?.createdAt ?? null,
        to: conversation.messages.at(-1)?.createdAt ?? null,
      },
      participants: conversation.participants,
      viewer: TEAMS_VIEWER,
    };
  });
  let ordinal = 0;
  const messages = transcript.conversations.flatMap((key, section) => {
    const conversation = TEAMS_STORY_CONVERSATIONS[key];
    const id =
      conversation.ref.kind === "chat"
        ? conversation.ref.chatId
        : conversation.ref.channelId;
    return conversation.messages.map((message, position) => {
      ordinal += 1;
      const messageId = `${key}-${1000 + position}`;
      const assets = conversation.assets
        .filter((entry) => entry.at === position)
        .map((entry) => ({
          name: entry.uploadName,
          displayName: entry.displayName,
          kind: entry.kind,
        }));
      const markers = assets.map((entry) =>
        entry.kind === "image"
          ? "[image]"
          : `[attachment: ${entry.displayName}]`,
      );
      return {
        ordinal,
        section,
        ref: {
          conversation: conversation.ref,
          messageId,
          parentMessageId: null,
        },
        sender: message.sender,
        createdAt: message.createdAt,
        editedAt: null,
        subject: null,
        deepLink: `https://teams.microsoft.com/l/message/${encodeURIComponent(id)}/${messageId}`,
        text: [message.text, ...markers].join(" "),
        assets,
      };
    });
  });
  return {
    version,
    exportedAt: EXPORTED_AT,
    timeZone: "UTC",
    sections,
    messages,
  };
}

/** The transcript file's text: prose for the model, then the index block. */
export function teamsStoryTranscriptText(
  transcript: TeamsStoryTranscript,
  format: { marker: string; version: number },
): string {
  const titles = transcript.conversations
    .map((key) => TEAMS_STORY_CONVERSATIONS[key].title)
    .join(", ");
  const prose = `# Teams chats: ${titles}\n\nThe conversations, as the model reads them.\n`;
  if (transcript.unreadable) return prose;
  // A `--` inside an HTML comment would end it early.
  const payload = JSON.stringify(
    teamsStoryIndex(transcript, format.version),
  ).replace(/-(?=-)/g, "\\u002d");
  return `${prose}\n<!-- ${format.marker} v${format.version} ${payload} -->\n`;
}

const THREE: TeamsStoryTranscript = {
  lineage: "three",
  uploadId: "three-v1",
  conversations: ["product", "design", "grace"],
};

export const TEAMS_STORIES = {
  Three: { transcripts: [THREE] },
  One: {
    transcripts: [
      { lineage: "one", uploadId: "one-v1", conversations: ["product"] },
    ],
  },
  WithFiles: {
    transcripts: [
      {
        lineage: "files",
        uploadId: "files-v1",
        conversations: ["product", "grace"],
      },
    ],
    userFiles: [
      { id: "user-holiday", filename: "holiday.pdf", size: 220 * KB },
      { id: "user-budget", filename: "budget-notes.docx", size: 36 * KB },
      { id: "user-photo", filename: "team-photo.png", size: 820 * KB },
    ],
  },
  PickedWithImage: {
    transcripts: [
      {
        lineage: "picked",
        uploadId: "picked-v1",
        conversations: ["graceWithImage"],
      },
    ],
  },
  PartialAndSkipped: {
    transcripts: [
      {
        lineage: "partial",
        uploadId: "partial-v1",
        conversations: ["productPartial"],
      },
    ],
  },
  Locked: { transcripts: [THREE], locked: true },
  Unreadable: {
    transcripts: [
      {
        lineage: "unreadable",
        uploadId: "unreadable-v1",
        conversations: ["product"],
        unreadable: true,
      },
    ],
  },
  // Both are teams-chats-2.md: the chips are told apart by upload id.
  TwoTranscripts: {
    transcripts: [
      {
        lineage: "first",
        uploadId: "first-v1",
        conversations: ["product", "design"],
      },
      {
        lineage: "second",
        uploadId: "second-v1",
        conversations: ["budget", "grace"],
      },
    ],
  },
  Reading: { transcripts: [{ ...THREE, slowRead: true }] },
  // The composer took the transcript and two of its three shared files.
  FileLimit: { transcripts: [{ ...THREE, notAttachedAssets: ["wireframes"] }] },
  NoPicker: { transcripts: [THREE], picker: false },
  Interactive: { transcripts: [THREE] },
} satisfies Record<string, TeamsStorySeed>;

export type TeamsStoryName = keyof typeof TEAMS_STORIES;

/** What a story's composer holds after an action: the add-in's state then. */
export const TEAMS_STORY_FLOWS: Record<
  string,
  { story: TeamsStoryName; then: TeamsStorySeed }
> = {
  // "Edit selection" → untick Design review → Update.
  updateWithoutDesign: {
    story: "Interactive",
    then: {
      transcripts: [teamsStoryUpdate(THREE, ["product", "grace"], 2)],
    },
  },
  // The detail's remove on roadmap-q1.pdf, then "Edit selection" → Update
  // with the selection unchanged: the file stays out.
  updateAfterRoadmapRemoved: {
    story: "Interactive",
    then: {
      transcripts: [
        {
          ...teamsStoryUpdate(THREE, ["product", "design", "grace"], 2),
          removedAssets: ["roadmap"],
        },
      ],
    },
  },
  // The detail's remove on roadmap-q1.pdf.
  roadmapRemoved: {
    story: "Three",
    then: { transcripts: [{ ...THREE, removedAssets: ["roadmap"] }] },
  },
  // "Remove all" under the chip: only the user's own files leave.
  userFilesRemoved: {
    story: "WithFiles",
    then: { transcripts: TEAMS_STORIES.WithFiles.transcripts },
  },
};

/** Storybook's id for a story export, e.g. `TwoTranscripts` → `two-transcripts`. */
export const teamsStoryId = (name: string) =>
  name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
