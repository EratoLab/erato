import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { powerpointPresentationChip } from "./powerpointPresentationChip";
import { AddinChatInputCore } from "../../core/AddinChatInputCore";
import {
  useAvailableActionFacetArgs,
  useAvailableActionFacetIds,
} from "../../core/clientActions/useAvailableActionFacets";
import { useConversationKey } from "../../core/selection/useConversationKey";
import { powerpointInclusionStore } from "../hooks/powerpointInclusionStore";
import { registerPowerPointClientTools } from "../utils/powerpointClientTools";
import {
  currentPowerPointPresentationName,
  readPowerPointSelectionSummary,
  resolvePowerPointFacet,
} from "../utils/powerpointFacet";
import {
  currentPowerPointReadSupport,
  logPowerPointReadSupport,
} from "../utils/powerpointReadSupport";

import type {
  AddinChatInputRenderProps,
  AddinSendPreparation,
} from "../../core/AddinChatCore";
import type { AddinChatInputCoreProps } from "../../core/AddinChatInputCore";
import type { PowerPointReadSupport } from "../utils/powerpointReadSupport";

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
  const [presentationName] = useState(currentPowerPointPresentationName);
  useEffect(() => logPowerPointReadSupport(support), [support]);

  const { chatId } = chatInputProps;
  const conversationKey = useConversationKey(chatId, PRESENTATION_IDENTITY);
  const included = powerpointInclusionStore.useIncluded(conversationKey);
  const readable = support.slides;

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

  const keyRef = useRef(conversationKey);
  keyRef.current = conversationKey;
  const locked = !!chatInputProps.disabled;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const setIncluded = useCallback((value: boolean) => {
    if (lockedRef.current) return;
    powerpointInclusionStore.setIncluded(keyRef.current, value);
  }, []);
  const include = useCallback(() => setIncluded(true), [setIncluded]);
  const exclude = useCallback(() => setIncluded(false), [setIncluded]);

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
            }),
          ]
        : [],
    [readable, presentationName, included, support, locked, include, exclude],
  );

  const availableFacetIds = useAvailableActionFacetIds();
  const availableFacetArgs = useAvailableActionFacetArgs();
  const facetsRef = useRef({ availableFacetIds, availableFacetArgs });
  facetsRef.current = { availableFacetIds, availableFacetArgs };

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
                  presentationName,
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
    [onSendMessage, support, presentationName],
  );

  return (
    <AddinChatInputCore
      {...chatInputProps}
      contextItems={contextItems}
      onSendMessage={handleSendMessage}
    />
  );
}
