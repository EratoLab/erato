import { action } from "@storybook/addon-actions";

import { ChatInput } from "../../components/ui/Chat/ChatInput";
import { ChatMessage } from "../../components/ui/Chat/ChatMessage";
import { AttachmentTile } from "../../components/ui/FileUpload/AttachmentTile";
import { AttachmentTileList } from "../../components/ui/FileUpload/AttachmentTileList";
import { FILE_TYPES } from "../../utils/fileTypes";

import type { AttachmentTileItem } from "../../components/ui/FileUpload/AttachmentTileList";
import type {
  FileCapability,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";
import type { Meta, StoryObj } from "@storybook/react";

/** Stand-in thumbnail: landscape, so cover-cropping into a square is visible. */
const photo = (from: string, to: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="150">
       <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
       </linearGradient></defs>
       <rect width="240" height="150" fill="url(#g)"/>
       <circle cx="60" cy="52" r="26" fill="rgba(255,255,255,0.55)"/>
       <path d="M0 150 L95 62 L165 150 Z" fill="rgba(0,0,0,0.28)"/>
       <path d="M120 150 L190 84 L240 150 Z" fill="rgba(0,0,0,0.18)"/>
     </svg>`,
  )}`;

const capability: FileCapability = {
  id: "generic",
  extensions: [],
  mime_types: [],
  operations: ["extract_text"],
};

const uploaded = (
  id: string,
  filename: string,
  previewUrl?: string,
): FileUploadItem => ({
  id,
  filename,
  download_url: `https://example.invalid/${id}`,
  preview_url: previewUrl,
  file_contents_unavailable_missing_permissions: false,
  is_sharepoint_file: false,
  file_capability: capability,
});

const item = (
  id: string,
  filename: string,
  previewUrl?: string,
): AttachmentTileItem => ({
  id,
  file: uploaded(id, filename),
  previewUrl,
});

const everydaySet: AttachmentTileItem[] = [
  item("1", "screenshot-pricing-slide.png", photo("#8ec5fc", "#e0c3fc")),
  item("2", "Erato_One-Pager_IT-Digital-Leitung.pdf"),
  item("3", "Acme_Inc_Organizational_Data.docx"),
];

const fullSet: AttachmentTileItem[] = [
  ...everydaySet,
  item("4", "team-offsite-photo.jpg", photo("#f6d365", "#fda085")),
  item("5", "Acme_Inc_Revenue_2000_2025.csv"),
];

const longNameSet: AttachmentTileItem[] = [
  item(
    "l1",
    "FY2026-enterprise-rollout-supporting-documentation-and-implementation-notes-final-review-v12.pdf",
  ),
  item(
    "l2",
    "Kickoff-Kundenportal-2.0-Lastenheft-und-Abnahmekriterien-Stand-August.docx",
  ),
  item("l3", "a.png", photo("#a1c4fd", "#c2e9fb")),
];

const meta = {
  title: "UI/AttachmentTile",
  component: AttachmentTileList,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "One tile for an attached file, shared by the composer, the message editor and the sent message. Compact keeps the composer dense; medium carries the transcript.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="bg-theme-bg-primary p-6">
        <div className="mx-auto max-w-[46rem]">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof AttachmentTileList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ComposerCompact: Story = {
  args: {
    items: everydaySet,
    size: "compact",
    onRemove: () => {},
    onActivate: () => {},
  },
};

export const ComposerAtFileLimit: Story = {
  args: {
    items: fullSet,
    size: "compact",
    onRemove: () => {},
    onRemoveAll: () => {},
    onActivate: () => {},
  },
};

export const ComposerNarrowPane: Story = {
  args: {
    items: fullSet,
    size: "compact",
    onRemove: () => {},
    onRemoveAll: () => {},
    onActivate: () => {},
  },
  parameters: {
    docs: {
      description: {
        story:
          "The Outlook task pane and mobile both land near 320px. Tiles must wrap without any horizontal scroll.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[320px] border border-dashed border-[var(--theme-border)] p-2">
        <Story />
      </div>
    ),
  ],
};

export const SentMessageMedium: Story = {
  args: {
    items: fullSet,
    size: "medium",
    onActivate: () => {},
  },
  parameters: {
    docs: {
      description: {
        story:
          "Read-only: no remove affordance, because nothing can be removed from a sent message.",
      },
    },
  },
};

/**
 * The middle tier: an image grows in place, capped at the chat image bounds,
 * without leaving the transcript. The corner toggle appears on hover or focus;
 * clicking the tile itself still opens the full preview.
 */
export const SentMessageExpandable: Story = {
  args: {
    items: fullSet,
    size: "medium",
    expandable: true,
    onActivate: () => {},
  },
};

export const SentMessageWithCaptions: Story = {
  args: {
    items: fullSet,
    size: "medium",
    showCaptions: true,
    onActivate: () => {},
  },
  parameters: {
    docs: {
      description: {
        story:
          "Same tiles with filenames under the thumbnails. Compare against SentMessageMedium to decide whether the caption earns its line.",
      },
    },
  },
};

/**
 * Hosts raise the file limit well past the web default — the Outlook pane
 * allows 50. The staged area caps and scrolls so the composer stays on screen.
 */
export const ComposerManyFilesScrolls: Story = {
  args: {
    items: [
      ...fullSet,
      ...Array.from({ length: 9 }, (_, index) =>
        item(`bulk-${index}`, `Quarterly-report-part-${index + 1}.pdf`),
      ),
    ],
    size: "compact",
    capHeight: true,
    maxFiles: 50,
    onRemove: () => {},
    onRemoveAll: () => {},
    onActivate: () => {},
  },
};

export const LongFilenames: Story = {
  args: {
    items: longNameSet,
    size: "compact",
    onRemove: () => {},
    onActivate: () => {},
  },
};

/** Every configured type, to check the per-type icon colour actually lands. */
export const AllFileTypes: Story = {
  args: { items: [] },
  render: () => {
    const sampleFor = (type: FileType) => {
      const extension = FILE_TYPES[type].extensions[0];
      return extension ? `example.${extension}` : "example";
    };
    return (
      <div className="flex flex-wrap items-start gap-2">
        {(Object.keys(FILE_TYPES) as FileType[]).map((type) => (
          <AttachmentTile
            key={type}
            file={uploaded(type, sampleFor(type))}
            size="compact"
            onRemove={() => {}}
          />
        ))}
      </div>
    );
  },
};

/**
 * Recipe: the tile inside the real composer, not a stand-in for it. `ChatInput`
 * renders `FileAttachmentsPreview`, which is what draws these tiles — so this
 * story breaks if the composer's own wiring regresses.
 *
 * The model selector and tool menu stay empty because Storybook has no backend
 * to answer `/me/models` and `/me/facets`.
 */
export const RecipeInChatInput: Story = {
  args: { items: [] },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="w-full bg-theme-bg-primary p-6">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <ChatInput
      onSendMessage={action("message sent")}
      handleFileAttachments={action("handle file attachments")}
      showControls
      showFileTypes
      initialFiles={[
        uploaded(
          "r1",
          "screenshot-pricing-slide.png",
          photo("#8ec5fc", "#e0c3fc"),
        ),
        uploaded("r2", "Erato_One-Pager_IT-Digital-Leitung.pdf"),
        uploaded("r3", "Acme_Inc_Revenue_2000_2025.csv"),
      ]}
    />
  ),
};

/**
 * Recipe: the tile in a sent message, via the real `ChatMessage`. Read-only —
 * a sent attachment has no remove affordance, because nothing can be removed
 * from it. With captions off, the filename lives in the tile's `title` and its
 * button label.
 *
 * `ChatMessage` resolves attachments from the `allFilesById` map the
 * conversation already holds, so this needs no API.
 */
export const RecipeInSentMessage: Story = {
  args: { items: [] },
  render: () => {
    const files = [
      uploaded(
        "m1",
        "screenshot-pricing-slide.png",
        photo("#8ec5fc", "#e0c3fc"),
      ),
      uploaded("m2", "team-offsite-photo.jpg", photo("#f6d365", "#fda085")),
      uploaded("m3", "Erato_One-Pager_IT-Digital-Leitung.pdf"),
      uploaded("m4", "Acme_Inc_Revenue_2000_2025.csv"),
    ];

    return (
      <ChatMessage
        message={{
          id: "msg-1",
          role: "user",
          sender: "user",
          authorId: "user_1",
          createdAt: new Date(2026, 7, 26, 12, 0).toISOString(),
          content: [
            {
              content_type: "text",
              text: "What do you see in these attachments?",
            },
          ],
          input_files_ids: files.map((file) => file.id),
        }}
        showAvatar
        controlsContext={{
          currentUserId: "user_1",
          dialogOwnerId: "user_1",
          isSharedDialog: false,
        }}
        onMessageAction={async () => true}
        onFilePreview={action("file preview")}
        allFilesById={Object.fromEntries(files.map((file) => [file.id, file]))}
      />
    );
  },
};

/**
 * Recipe: a sent Teams message. The transcript and the files shared inside it
 * are gathered from the names the picker minted — no transcript download — so
 * they read as one conversation rather than as loose siblings.
 */
export const RecipeTeamsConversation: Story = {
  args: { items: [] },
  render: () => {
    const files = [
      uploaded("t1", "teams-Product_sync.md"),
      uploaded("f1", "teams-file-abcd1234-Q3_report.pdf"),
      uploaded(
        "i1",
        "teams-img-0123456789abcdef.png",
        photo("#8ec5fc", "#e0c3fc"),
      ),
      uploaded("o1", "unrelated-notes.docx"),
    ];

    return (
      <ChatMessage
        message={{
          id: "msg-teams",
          role: "user",
          sender: "user",
          authorId: "user_1",
          createdAt: new Date(2026, 7, 27, 9, 0).toISOString(),
          content: [
            { content_type: "text", text: "What did we agree in this chat?" },
          ],
          input_files_ids: files.map((entry) => entry.id),
        }}
        showAvatar
        controlsContext={{
          currentUserId: "user_1",
          dialogOwnerId: "user_1",
          isSharedDialog: false,
        }}
        onMessageAction={async () => true}
        onFilePreview={action("file preview")}
        allFilesById={Object.fromEntries(files.map((f) => [f.id, f]))}
      />
    );
  },
};
