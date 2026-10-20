import { i18n } from "@lingui/core";
import { action } from "@storybook/addon-actions";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { ChatInput } from "@/components/ui/Chat/ChatInput";
import { DefaultMessageControls } from "@/components/ui/Message/DefaultMessageControls";
import { MessageEditProvider } from "@/components/ui/MessageList/MessageEditContext";
import { MessageItem } from "@/components/ui/MessageList/MessageItem";
import { componentRegistry } from "@/config/componentRegistry";
import { facetsQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { registerSentWithDescriptors } from "@/utils/chat/sentWith";
import {
  TEAMS_TRANSCRIPT_INDEX_MARKER,
  TEAMS_TRANSCRIPT_INDEX_VERSION,
} from "@/utils/teams/teamsTranscriptIndex";

import PARITY from "./composerContextParity.generated.json";
import {
  PARITY_EDIT_STORIES,
  PARITY_SENT_STORIES,
} from "./composerContextParityScenarios";
import { AnnouncementLog, noop, stagedFile } from "./composerContextStoryKit";
import {
  teamsStoryTranscriptText,
  teamsStoryTranscriptUploads,
} from "./composerContextTeamsScenarios";

import type {
  ParityEditStory,
  ParityEditStoryName,
  ParityEditTranscript,
  ParityFacetKey,
  ParitySentStoryName,
} from "./composerContextParityScenarios";
import type {
  ComposerContextChipFaceProps,
  ComposerContextItem,
  ComposerMode,
} from "@/components/ui/Chat/ComposerContext/types";
import type { ChatInputAttachmentPreviewProps } from "@/components/ui/FileUpload/FileAttachmentsPreview";
import type {
  ChatModel,
  FacetInfo,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";
import type { SentWithChip } from "@/utils/chat/sentWith";
import type { ReactNode } from "react";

interface GeneratedFacet {
  facet: { id: string; args: Record<string, string> };
  registered: boolean;
  chips: Record<string, SentWithChip[] | null>;
  estimateBytes: number;
}

const FACETS = PARITY.facets as Record<ParityFacetKey, GeneratedFacet>;

/**
 * Plays the add-in's descriptors from the generated file: each facet id
 * answers with the chips the add-in wrote for the same args, in the active
 * locale. A facet the add-in registers nothing for stays unregistered.
 */
const installParityDescriptors = () => {
  const byFacet = new Map<string, Map<string, GeneratedFacet["chips"]>>();
  for (const entry of Object.values(FACETS)) {
    if (!entry.registered) continue;
    const byArgs = byFacet.get(entry.facet.id) ?? new Map();
    byArgs.set(JSON.stringify(entry.facet.args), entry.chips);
    byFacet.set(entry.facet.id, byArgs);
  }
  registerSentWithDescriptors(
    Object.fromEntries(
      [...byFacet].map(([facetId, byArgs]) => [
        facetId,
        (args: Readonly<Record<string, string>>) => {
          const chips = byArgs.get(JSON.stringify(args));
          return chips ? (chips[i18n.locale] ?? chips.en) : null;
        },
      ]),
    ),
  );
};

installParityDescriptors();

// A stored transcript whose read never settles: the edit lane's loading chip.
const PENDING_URL = "https://story.invalid/pending/";
const withPendingFetch = window as Window & { __parityPendingFetch?: true };
if (!withPendingFetch.__parityPendingFetch) {
  withPendingFetch.__parityPendingFetch = true;
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return url.startsWith(PENDING_URL)
      ? new Promise<Response>(noop)
      : original(input, init);
  };
}

const storyQueryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

const fileOf = (id: string, filename: string): FileUploadItem => {
  const extension = filename.split(".").pop() ?? "pdf";
  return {
    ...stagedFile(id, filename),
    file_capability: {
      id: extension,
      extensions: [extension],
      mime_types: [
        extension === "pdf" ? "application/pdf" : "application/octet-stream",
      ],
      operations: ["extract_text"],
    },
  };
};

const textMessage = (
  id: string,
  role: "user" | "assistant",
  text: string,
  extra: Partial<Message> = {},
): Message => ({
  id,
  role,
  content: [{ content_type: "text", text }],
  createdAt: "2026-10-20T09:00:00Z",
  status: "complete",
  ...extra,
});

const facetFields = (key: ParityFacetKey | undefined): Partial<Message> => {
  if (!key) return {};
  const { facet } = FACETS[key];
  return { action_facet_id: facet.id, action_facet_args: facet.args };
};

const ANSWER = "Here is what I found.";

const controlsContext = {
  currentUserId: "user_id",
  dialogOwnerId: "user_id",
  isSharedDialog: false,
  canEdit: true,
};

/**
 * A user message and its answer, through the real `MessageItem` and
 * `ChatMessage`; Edit opens the real `MessageEditor` in its place. Submit
 * writes the ids it would send to `data-story-log`.
 */
const Thread = ({
  user,
  files,
  editing = false,
  isActionFacetAvailable,
}: {
  user: Message;
  files: FileUploadItem[];
  editing?: boolean;
  isActionFacetAvailable?: (facetId: string) => boolean;
}) => {
  const [queryClient] = useState(storyQueryClient);
  const [editingId, setEditingId] = useState<string | null>(
    editing ? user.id : null,
  );
  const [log, setLog] = useState<string | null>(null);
  const answer = useMemo(() => textMessage("a1", "assistant", ANSWER), []);
  const filesById = useMemo(
    () => Object.fromEntries(files.map((file) => [file.id, file])),
    [files],
  );
  const item = (message: Message) => (
    <MessageItem
      key={message.id}
      messageId={message.id}
      message={message}
      isNew={false}
      showTimestamp
      controls={DefaultMessageControls}
      controlsContext={controlsContext}
      onMessageAction={async (messageAction) => {
        if (messageAction.type === "edit") setEditingId(message.id);
        return true;
      }}
      allFilesById={filesById}
      onFilePreview={action("preview")}
    />
  );
  return (
    <QueryClientProvider client={queryClient}>
      <MessageEditProvider
        value={{
          editingMessageId: editingId,
          beginEdit: setEditingId,
          cancelEdit: () => setEditingId(null),
          submitEdit: (_id, _content, inputFileIds) => {
            setLog(inputFileIds.join(","));
            setEditingId(null);
          },
          isActionFacetAvailable,
        }}
      >
        <div data-story-thread="" className="flex flex-col gap-4">
          {item(user)}
          {item(answer)}
        </div>
        <pre
          data-story-log=""
          data-submitted={log === null ? undefined : "true"}
          className="mt-3 text-xs text-theme-fg-secondary"
        >
          {log === null ? "" : `Submitted files: ${log || "(none)"}`}
        </pre>
        <AnnouncementLog />
      </MessageEditProvider>
    </QueryClientProvider>
  );
};

export const SentStory = ({ name }: { name: ParitySentStoryName }) => {
  const story = PARITY_SENT_STORIES[name];
  const user = useMemo(
    () => textMessage("u1", "user", story.text, facetFields(story.facet)),
    [story],
  );
  return <Thread user={user} files={[]} />;
};

/** The transcript upload and its assets, the way the Teams tab stored them. */
const useTranscriptUploads = (
  transcript: ParityEditTranscript | undefined,
): FileUploadItem[] => {
  const uploads = useMemo(() => {
    if (!transcript) return [];
    const record = {
      lineage: "edit",
      uploadId: "edit-v1",
      conversations: transcript.conversations,
      unreadable: transcript.unreadable,
    };
    const { transcript: upload, assets } = teamsStoryTranscriptUploads(record);
    const url = transcript.pending
      ? `${PENDING_URL}${upload.id}`
      : URL.createObjectURL(
          new Blob(
            [
              teamsStoryTranscriptText(record, {
                marker: TEAMS_TRANSCRIPT_INDEX_MARKER,
                version: TEAMS_TRANSCRIPT_INDEX_VERSION,
              }),
            ],
            { type: "text/markdown" },
          ),
        );
    return [
      { ...fileOf(upload.id, upload.filename), download_url: url },
      ...assets.map((asset) => fileOf(asset.id, asset.filename)),
    ];
  }, [transcript]);
  useEffect(
    () => () => {
      const url = uploads.at(0)?.download_url;
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    },
    [uploads],
  );
  return uploads;
};

export const EditStory = ({ name }: { name: ParityEditStoryName }) => {
  const story: ParityEditStory = PARITY_EDIT_STORIES[name];
  const transcriptUploads = useTranscriptUploads(story.transcript);
  const files = useMemo(
    () => [
      ...transcriptUploads,
      ...(story.files ?? []).map((filename, index) =>
        fileOf(`user-file-${index + 1}`, filename),
      ),
    ],
    [story, transcriptUploads],
  );
  const user = useMemo(
    () => ({
      ...textMessage("u1", "user", story.text, {
        input_files_ids: files.map((file) => file.id),
        ...facetFields(story.facet),
      }),
      files,
    }),
    [files, story],
  );
  const thread = (
    <Thread
      user={user}
      files={files}
      editing
      isActionFacetAvailable={story.facetUnavailable ? () => false : undefined}
    />
  );
  return story.kit ? <WithKit>{thread}</WithKit> : thread;
};

const SampleKitFace = ({ item, icon, meta }: ComposerContextChipFaceProps) => (
  <span
    data-testid="sample-kit-face"
    data-component-kit="sample"
    className="flex min-w-0 flex-1 items-center gap-2 font-mono text-xs"
  >
    {icon}
    <span className="truncate uppercase tracking-wide">{item.label}</span>
    {meta ? <span className="truncate opacity-80">{`[${meta}]`}</span> : null}
  </span>
);

const SampleKitTiles = ({
  attachedFiles,
  onRemoveFile,
}: ChatInputAttachmentPreviewProps) => (
  <ul data-component-kit="sample-tiles" className="flex flex-col gap-1">
    {attachedFiles.map((file) => (
      <li
        key={file.id}
        data-testid="sample-kit-tile"
        className="flex items-center justify-between border border-dashed border-theme-border px-2 py-1 font-mono text-xs uppercase"
      >
        <span className="truncate">{file.filename}</span>
        <button
          type="button"
          aria-label={`Remove ${file.filename}`}
          onClick={() => onRemoveFile(file.id)}
        >
          remove
        </button>
      </li>
    ))}
  </ul>
);

/** Installs a kit's chip face and attachment preview, and puts the host's back after. */
const WithKit = ({ children }: { children: ReactNode }) => {
  const [previous] = useState(() => {
    const host = {
      face: componentRegistry.ComposerContextChipFace,
      preview: componentRegistry.ChatInputAttachmentPreview,
    };
    componentRegistry.ComposerContextChipFace = SampleKitFace;
    componentRegistry.ChatInputAttachmentPreview = SampleKitTiles;
    return host;
  });
  useEffect(
    () => () => {
      componentRegistry.ComposerContextChipFace = previous.face;
      componentRegistry.ChatInputAttachmentPreview = previous.preview;
    },
    [previous],
  );
  return children;
};

export const STORY_TOOLS: FacetInfo[] = [
  {
    id: "web_search",
    display_name: "Web search",
    icon: "iconoir-globe",
    default_enabled: false,
  },
  {
    id: "extended_thinking",
    display_name: "Extended thinking",
    icon: "iconoir-brain",
    default_enabled: false,
  },
];

export const LONG_TOOL: FacetInfo = {
  id: "knowledge_search",
  display_name: "Company knowledge base search across all SharePoint sites",
  icon: "iconoir-book",
  default_enabled: false,
};

const MODELS: ChatModel[] = [
  { chat_provider_id: "gpt-4o", model_display_name: "GPT-4o" },
  { chat_provider_id: "sonnet", model_display_name: "Sonnet 4.5" },
];

const NoExtraContent = () => null;

/** Registers add-menu content the way the Outlook and Teams add-ins do, so the "+" menu is used at any width. */
const WithAddMenuContent = ({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) => {
  const [previous] = useState(() => {
    const host = componentRegistry.ChatAddMenuExtraContent;
    if (enabled) componentRegistry.ChatAddMenuExtraContent = NoExtraContent;
    return host;
  });
  useEffect(
    () => () => {
      componentRegistry.ChatAddMenuExtraContent = previous;
    },
    [previous],
  );
  return children;
};

export interface ToolComposerProps {
  tools?: FacetInfo[];
  selected?: string[];
  enforce?: boolean;
  /** Add-menu content is registered, as in the Outlook and Teams add-ins. */
  addMenuContent?: boolean;
  modes?: ComposerMode[];
  contextItems?: ComposerContextItem[];
  initialFiles?: FileUploadItem[];
  maxFiles?: number;
  /** Audio mode is on: the controls row carries "Exit audio mode". */
  audioMode?: boolean;
  /** Rendered instead of the plain composer, inside the seeded providers. */
  children?: ReactNode;
}

/** The real `ChatInput` with the facets query seeded, as `useFacets` reads it. */
export const ToolComposer = ({
  tools = STORY_TOOLS,
  selected,
  enforce,
  addMenuContent = false,
  modes,
  contextItems,
  initialFiles,
  maxFiles = 20,
  audioMode = false,
  children,
}: ToolComposerProps) => {
  const [queryClient] = useState(() => {
    const client = storyQueryClient();
    client.setQueryData(facetsQuery({}).queryKey, {
      facets: tools,
      global_facet_settings: {
        only_single_facet: false,
        show_facet_indicator_with_display_name: false,
      },
    });
    return client;
  });
  const [model, setModel] = useState(MODELS[0]);
  return (
    <QueryClientProvider client={queryClient}>
      <WithAddMenuContent enabled={addMenuContent}>
        <div className="flex min-h-[calc(100vh-32px)] flex-col justify-end">
          {children ?? (
            <ChatInput
              onSendMessage={action("send")}
              handleFileAttachments={action("files")}
              initialSelectedFacetIds={selected ?? tools.map((tool) => tool.id)}
              enforceSelectedFacetIds={enforce}
              composerModes={modes}
              contextItems={contextItems}
              initialFiles={initialFiles}
              maxFiles={maxFiles}
              showControls
              controlledAvailableModels={MODELS}
              controlledSelectedModel={model}
              controlledIsModelSelectionReady
              onControlledSelectedModelChange={setModel}
              {...(audioMode
                ? {
                    controlledIsAudioMode: true,
                    onControlledIsAudioModeChange: noop,
                  }
                : {})}
            />
          )}
          <AnnouncementLog
            regions={[
              '[data-ui="composer-tool-live"]',
              '[data-ui="composer-context-live"]',
            ]}
          />
        </div>
      </WithAddMenuContent>
    </QueryClientProvider>
  );
};

/** An email the send would upload, sized without holding its bytes. */
const uploadOf = (name: string, bytes: number) => {
  const file = new File(["x"], name, { type: "message/rfc822" });
  Object.defineProperty(file, "size", { value: bytes });
  return file;
};

const MB = 1024 * 1024;

export const dropItem = (
  id: string,
  label: string,
  sender: string,
  bytes: number,
): ComposerContextItem => ({
  id: `drop:${id}`,
  kind: "outlook.drop",
  origin: "user",
  state: "included",
  label,
  meta: `${sender} · ${Math.round(bytes / MB)} MB`,
  icon: "mail",
  estimate: uploadOf(`${label}.eml`, bytes),
  estimateUpload: true,
  onRemove: noop,
});

export const userFile = fileOf;
