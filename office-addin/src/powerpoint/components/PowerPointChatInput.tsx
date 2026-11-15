import {
  useChatInputControls,
  useLiveAnnouncement,
} from "@erato/frontend/library";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PowerPointComposerContext } from "./PowerPointComposerContext";
import { powerpointPresentationChip } from "./powerpointPresentationChip";
import { AddinChatInputCore } from "../../core/AddinChatInputCore";
import {
  useAvailableActionFacetArgs,
  useAvailableActionFacetIds,
} from "../../core/clientActions/useAvailableActionFacets";
import { useConversationKey } from "../../core/selection/useConversationKey";
import { powerpointInclusionStore } from "../hooks/powerpointInclusionStore";
import { usePowerPointSlidePictures } from "../hooks/usePowerPointSlidePictures";
import { registerPowerPointClientTools } from "../utils/powerpointClientTools";
import {
  currentPowerPointPresentationName,
  POWERPOINT_PRESENTATION_FACET_ID,
  readPowerPointSelectionSummary,
  resolvePowerPointFacet,
} from "../utils/powerpointFacet";
import {
  currentPowerPointReadSupport,
  logPowerPointReadSupport,
} from "../utils/powerpointReadSupport";

import type { PowerPointComposerContextValue } from "./PowerPointComposerContext";
import type {
  AddinChatInputRenderProps,
  AddinSendPreparation,
} from "../../core/AddinChatCore";
import type { AddinChatInputCoreProps } from "../../core/AddinChatInputCore";
import type { PowerPointReadSupport } from "../utils/powerpointReadSupport";
import type { FileUploadItem } from "@erato/frontend/library";

/** One deck per pane: the pane closes with its presentation. */
const PRESENTATION_IDENTITY = "powerpoint.presentation";

export function PowerPointChatInput({
  chatInputProps,
  support: supportOverride,
}: {
  chatInputProps: AddinChatInputRenderProps;
  /** For tests; the pane reads the host once. */
  support?: PowerPointReadSupport;
}) {
  const [support] = useState(
    () => supportOverride ?? currentPowerPointReadSupport(),
  );
  // Read on every render: Save As renames the deck while the pane stays open.
  const presentationName = currentPowerPointPresentationName();
  useEffect(() => logPowerPointReadSupport(support), [support]);

  const { chatId } = chatInputProps;
  const conversationKey = useConversationKey(chatId, PRESENTATION_IDENTITY);
  const included = powerpointInclusionStore.useIncluded(conversationKey);
  const availableFacetIds = useAvailableActionFacetIds();
  const availableFacetArgs = useAvailableActionFacetArgs();
  const facetsRef = useRef({ availableFacetIds, availableFacetArgs });
  facetsRef.current = { availableFacetIds, availableFacetArgs };
  // Like Word's chip: without the facet the model learns nothing of the deck and gets no tools.
  const readable =
    support.slides && availableFacetIds.has(POWERPOINT_PRESENTATION_FACET_ID);

  const readEnabledRef = useRef(included && readable);
  readEnabledRef.current = included && readable;
  const lastSendIncludedRef = useRef(false);
  useEffect(
    () =>
      registerPowerPointClientTools({
        support,
        readEnabled: () => readEnabledRef.current,
        listed: () => lastSendIncludedRef.current || readEnabledRef.current,
      }),
    [support],
  );

  const controls = useChatInputControls();
  const [announcement, announce] = useLiveAnnouncement();
  const [stagedCount, setStagedCount] = useState(0);
  const onStagedFilesChange = useCallback(
    (files: FileUploadItem[]) => setStagedCount(files.length),
    [],
  );
  const {
    offer: slidePicture,
    notice,
    clearNotice,
  } = usePowerPointSlidePictures({
    enabled: support.slidePicture && readable && included,
    modelId: chatInputProps.controlledSelectedModel?.chat_provider_id,
    conversationKey,
    uploadFiles: chatInputProps.uploadFiles,
    addUploadedFiles: controls.addUploadedFiles,
    stagedCount,
    maxFiles: chatInputProps.maxFiles,
    announce,
  });

  const keyRef = useRef(conversationKey);
  keyRef.current = conversationKey;
  // Held while a slide picture renders and uploads, so a Send cannot leave without it.
  const composerDisabled = !!chatInputProps.disabled || slidePicture.busy;
  const locked = composerDisabled;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const setIncluded = useCallback((value: boolean) => {
    if (lockedRef.current) return;
    powerpointInclusionStore.setIncluded(keyRef.current, value);
  }, []);
  const include = useCallback(() => setIncluded(true), [setIncluded]);
  const exclude = useCallback(() => setIncluded(false), [setIncluded]);

  const attachSlidePicture = slidePicture.available
    ? slidePicture.attach
    : undefined;
  const contextItems = useMemo(
    () =>
      readable
        ? [
            powerpointPresentationChip({
              name: presentationName,
              included,
              support,
              locked,
              onInclude: include,
              onExclude: exclude,
              onAttachSlidePicture: attachSlidePicture,
            }),
          ]
        : [],
    [
      readable,
      presentationName,
      included,
      support,
      locked,
      include,
      exclude,
      attachSlidePicture,
    ],
  );
  const composer = useMemo<PowerPointComposerContextValue>(
    () => ({ slidePicture }),
    [slidePicture],
  );

  const { onSendMessage } = chatInputProps;
  const handleSendMessage = useCallback<
    AddinChatInputCoreProps["onSendMessage"]
  >(
    (
      message,
      inputFileIds,
      modelId,
      selectedFacetIds,
      mentionedAssistants,
      delegationRunMode,
      mcpWriteToolsEnabled,
      disabledMcpServerIds,
      disabledMcpTools,
    ) => {
      clearNotice();
      const sendsPresentation = readEnabledRef.current;
      lastSendIncludedRef.current = sendsPresentation;
      const prepare: AddinSendPreparation | undefined = sendsPresentation
        ? {
            run: async () => {
              const selectionSummary =
                await readPowerPointSelectionSummary(support);
              return {
                actionFacet: resolvePowerPointFacet({
                  support,
                  presentationName: currentPowerPointPresentationName(),
                  selectionSummary,
                  ...facetsRef.current,
                }),
                hostContextIdentity: null,
              };
            },
          }
        : undefined;
      onSendMessage(
        message,
        inputFileIds,
        modelId,
        selectedFacetIds,
        undefined,
        undefined,
        mentionedAssistants,
        delegationRunMode,
        mcpWriteToolsEnabled,
        disabledMcpServerIds,
        disabledMcpTools,
        prepare,
      );
    },
    [onSendMessage, support, clearNotice],
  );

  return (
    <PowerPointComposerContext.Provider value={composer}>
      <AddinChatInputCore
        {...chatInputProps}
        disabled={composerDisabled}
        contextItems={contextItems}
        composerNotice={notice}
        onStagedFilesChange={onStagedFilesChange}
        onSendMessage={handleSendMessage}
      />
      <div
        className="sr-only"
        aria-live="polite"
        data-testid="powerpoint-composer-announcer"
      >
        {announcement}
      </div>
    </PowerPointComposerContext.Provider>
  );
}
