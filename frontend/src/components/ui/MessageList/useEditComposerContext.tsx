import { t } from "@lingui/core/macro";
import { useMemo } from "react";

import { actionFacetEstimate } from "@/components/ui/Chat/ComposerContext/actionFacetEstimate";
import {
  claimedFileIdsOf,
  includedEstimatesOf,
  unclaimedFiles,
} from "@/components/ui/Chat/ComposerContext/composerLaneFiles";
import { useStableFileList } from "@/components/ui/Chat/ComposerContext/useStableFileList";
import { useSentTeamsTranscriptContextItems } from "@/components/ui/Teams/useSentTeamsTranscriptContextItems";
import { sentWithChipsFor } from "@/utils/chat/sentWith";

import { EditFacetDetail } from "./EditFacetDetail";

import type { ComposerContextItem } from "@/components/ui/Chat/ComposerContext/types";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

export interface EditComposerContextInput {
  message: Pick<Message, "role" | "action_facet_id" | "action_facet_args">;
  /** The files the edit would send now. */
  files: FileUploadItem[];
  onRemoveFiles: (fileIds: string[]) => void;
  onFilePreview?: (file: FileUploadItem) => void;
  /** Whether the server still offers a facet; one it would drop shows no chip. */
  isActionFacetAvailable?: (facetId: string) => boolean;
}

export interface EditComposerContext {
  items: ComposerContextItem[];
  /** The files no included or loading chip stands for. */
  slotFiles: FileUploadItem[];
  /** What the included chips add to the token estimate. */
  estimates: File[];
}

export const sentAsBeforeMeta = () =>
  t({ id: "chat.messageEditor.context.meta", message: "Sent as before" });

export const editContextLockReason = () =>
  t({
    id: "chat.messageEditor.context.lockReason",
    message:
      "An edited message keeps the context it was sent with. To leave it out, write a new message.",
  });

const noop = () => {};

/**
 * The context lane of a message being edited. The server sends the stored
 * facet again with the edit, so its chips are locked and included; Teams
 * transcripts are files of the message and leave with their (x), as in the
 * composer.
 */
export function useEditComposerContext({
  message,
  files,
  onRemoveFiles,
  onFilePreview,
  isActionFacetAvailable,
}: EditComposerContextInput): EditComposerContext {
  const teamsItems = useSentTeamsTranscriptContextItems(files, {
    onRemoveFiles,
    onFilePreview,
  });

  const facetId = message.action_facet_id;
  const facetArgs = message.action_facet_args;
  const facetResent =
    !!facetId &&
    !!facetArgs &&
    (isActionFacetAvailable === undefined || isActionFacetAvailable(facetId));
  const chips = facetResent ? sentWithChipsFor(message) : null;

  const facetItems = useMemo<ComposerContextItem[]>(() => {
    if (!chips || chips.length === 0 || !facetId || !facetArgs) return [];
    const lockReason = editContextLockReason();
    const meta = sentAsBeforeMeta();
    // Exact: the server sends these stored args again.
    const estimate = actionFacetEstimate({ id: facetId, args: facetArgs });
    return chips.map(
      (chip, index): ComposerContextItem => ({
        id: `sent-with:${chip.id}`,
        kind: chip.kind,
        origin: "user",
        placement: "ambient",
        state: "included",
        label:
          chip.labelIsExcerpt && chip.spokenLabel
            ? chip.spokenLabel
            : chip.label,
        meta,
        spokenLabel: chip.spokenLabel,
        icon: chip.icon,
        locked: true,
        lockReason,
        onRemove: noop,
        ...(index === 0 ? { estimate } : {}),
        detail: {
          title: chip.spokenLabel ?? chip.label,
          render: () => <EditFacetDetail chip={chip} note={lockReason} />,
        },
      }),
    );
  }, [chips, facetArgs, facetId]);

  const items = useMemo(
    () =>
      facetItems.length === 0
        ? teamsItems
        : teamsItems.length === 0
          ? facetItems
          : [...facetItems, ...teamsItems],
    [facetItems, teamsItems],
  );

  const claimed = useMemo(() => claimedFileIdsOf(items), [items]);
  const slotFiles = useMemo(
    () => unclaimedFiles(files, claimed),
    [files, claimed],
  );
  const estimates = useStableFileList(
    useMemo(() => includedEstimatesOf(items), [items]),
  );

  return { items, slotFiles, estimates };
}
