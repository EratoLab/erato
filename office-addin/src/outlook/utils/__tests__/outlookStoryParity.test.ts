import { formatFileSize } from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import { cleanup, renderHook } from "@testing-library/react";
import { format } from "prettier";
import { afterEach, beforeAll, expect, it } from "vitest";

import {
  OUTLOOK_APPOINTMENT,
  OUTLOOK_DRAFT_BODY,
  OUTLOOK_LIMIT,
  OUTLOOK_REPLY_SENDER,
  OUTLOOK_SCHEDULING_UNTIL,
  OUTLOOK_SELECTION_TEXT,
  OUTLOOK_STORIES,
  OUTLOOK_STORY_FLOWS,
  OUTLOOK_THREAD_SUBJECT,
  outlookStoryId,
  outlookStoryState,
  storyDropStats,
  storyThreadStats,
} from "../../../../../frontend/src/stories/chat/composerContextOutlookScenarios";
import { useOutlookContextItems } from "../../hooks/useOutlookContextItems";
import {
  outlookDraftFingerprint,
  previewOutlookSend,
} from "../outlookActionFacet";
import { outlookContextChips } from "../outlookContextChips";
import { planOutlookFiles } from "../outlookSendFiles";

import type { OutlookStoryState } from "../../../../../frontend/src/stories/chat/composerContextOutlookScenarios";
import type {
  OutlookContextDetailData,
  OutlookContextHandlers,
} from "../../hooks/useOutlookContextItems";
import type { StagedDropEmail } from "../buildDropEmailGroup";
import type { OutlookContextDisplay } from "../outlookContextChips";
import type {
  ComposerContextItem,
  ComposerMode,
} from "@erato/frontend/library";

// The Storybook stories play the add-in's rules from data. This runs the
// add-in's own resolvers on every story and flow and writes what each draws;
// the Storybook spec holds the stories to that file, so the copy cannot drift
// from the add-in unnoticed. After a deliberate change, update the file with
// `pnpm exec vitest run src/outlook/utils/__tests__/outlookStoryParity.test.ts -u`
// and then the stories until the spec agrees.
const EXPECTED =
  "../../../../../e2e-tests/storybook-outlook-context-chips/outlook-chips.expected.json";

const noop = () => {};
const handlers: OutlookContextHandlers = {
  dismissSelection: noop,
  rearmSelection: noop,
  sendDraftInstead: noop,
  setDraftOff: noop,
  excludeThread: noop,
  includeThread: noop,
  retryThread: noop,
  signInForEmail: noop,
  restoreEveryMessage: noop,
  dismissAttachment: noop,
  restoreAttachment: noop,
  untickAttachment: noop,
  tickAttachment: noop,
  includeAttachmentsOnFollowUp: noop,
  setAttachmentsGroupOff: noop,
  removeDrop: noop,
  endScheduling: noop,
  thread: {
    dismissMessage: noop,
    restoreMessage: noop,
    dismissAttachment: noop,
    restoreAttachment: noop,
  },
  dismissDropAttachment: noop,
  restoreDropAttachment: noop,
};

/** What the add-in would hand the lane and the controls row for a story's state. */
function addinContext(state: OutlookStoryState): {
  items: ComposerContextItem[];
  modes: ComposerMode[];
} {
  const compose = state.host === "compose";
  const appointment = compose && state.itemKind === "appointment";
  const itemKind = compose ? state.itemKind : "message";
  const draftAvailable = compose && (appointment || state.draft !== "none");
  const draftBody = draftAvailable && !appointment ? OUTLOOK_DRAFT_BODY : "";
  const draftContextFingerprint = appointment ? "appointment" : undefined;
  const fingerprint = outlookDraftFingerprint({
    itemKind,
    isComposeMode: compose,
    draftBody,
    draftContextFingerprint,
  });
  const preview = previewOutlookSend({
    itemKind,
    hasActiveSelection: compose && state.selection === "active",
    selectionData: compose && state.selection ? OUTLOOK_SELECTION_TEXT : "",
    selectionSource: "body",
    draftContextIncluded: draftAvailable && !state.draftOff,
    draftBody,
    draftContextFingerprint,
    isComposeMode: compose,
    composeEmailAvailable: true,
    appointmentRewriteAvailable: true,
    appointmentContextAvailable: true,
    isReadMode: !compose,
    replyFromReadAvailable: true,
    scheduleFacetAvailable: true,
    calendarAvailable: true,
    schedulingThreadActive: state.scheduling,
    lastSentDraft:
      draftAvailable && state.draft === "unchanged"
        ? { sent: fingerprint, seen: fingerprint }
        : null,
  });

  const stats = storyThreadStats(state);
  const threadBuilt = stats.included > 0 && !stats.trimFailed;
  const ticked = (id: string) => !state.dismissedAttachments.includes(id);
  const dropStats = state.drops.map((drop) => ({
    drop,
    ...storyDropStats(state, drop),
  }));
  const plan = planOutlookFiles({
    freshChat: state.freshChat,
    thread: {
      status: compose ? "none" : state.threadStatus,
      signIn: state.threadStatus === "error" ? state.signIn : null,
      messageCount: stats.total,
      includedMessageCount: stats.included,
      file: threadBuilt ? new File(["thread"], "conversation.eml") : null,
      stale: false,
      partKey: "current-thread:story",
      trimError: stats.trimFailed,
      conversationId: "story",
      choice: state.threadChoice,
      sentInChat: state.threadSentInChat,
      stagedAsDrop: state.openEmailDropped,
    },
    attachments: {
      mode: compose ? "compose" : "read",
      items: state.attachments.map((attachment) => ({
        id: attachment.id,
        cloud: attachment.cloud === true,
        ticked: ticked(attachment.id),
      })),
      loading: false,
      groupOff: state.attachmentsGroupOff,
      includeOnFollowUpIds: new Set(state.followUpIds),
      sentIds: new Set(state.sentAttachmentIds),
    },
    drops: dropStats.map(({ drop, size, trimFailed }) => ({
      key: drop.key,
      file: trimFailed ? null : new File(["drop"], drop.fileName),
      size,
      error: trimFailed,
    })),
    dropsStale: false,
  });

  const display: OutlookContextDisplay = {
    freshChat: state.freshChat,
    itemKind,
    selection:
      compose && state.selection
        ? {
            text: OUTLOOK_SELECTION_TEXT,
            dismissed: state.selection === "dismissed",
          }
        : null,
    draft: draftAvailable
      ? {
          kind: appointment ? "appointment" : "message",
          off: state.draftOff,
          body: draftBody,
          parent:
            !appointment && state.reply
              ? {
                  subject: OUTLOOK_THREAD_SUBJECT,
                  sender: OUTLOOK_REPLY_SENDER,
                }
              : null,
          recipients: null,
          appointment: appointment ? OUTLOOK_APPOINTMENT : null,
        }
      : null,
    thread: {
      subject: OUTLOOK_THREAD_SUBJECT,
      sizeLabel: threadBuilt ? formatFileSize(stats.size) : null,
      stale: false,
      signingIn: state.signingIn,
      includedMessages: stats.included,
      totalMessages: stats.total,
    },
    maxSizeFormatted: OUTLOOK_LIMIT,
    attachments: {
      mode: compose ? "compose" : "read",
      rows: state.attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        size: attachment.size,
        sizeLabel: formatFileSize(attachment.size),
        type: attachment.type,
        ticked: ticked(attachment.id),
        cloud: attachment.cloud === true,
      })),
      groupOff: state.attachmentsGroupOff,
    },
    drops: dropStats.map(({ drop, kept, total }) => ({
      key: drop.key,
      subject: drop.subject,
      senderAndDate: `${drop.sender} • ${drop.date}`,
      kept,
      total,
    })),
    dropProgress: state.dropProgress,
    schedulingUntil:
      preview.mode === "scheduling" ? OUTLOOK_SCHEDULING_UNTIL : null,
    formatSize: formatFileSize,
  };

  // Only the drop chips need their staged email; the details are not drawn.
  const stagedDrops: StagedDropEmail[] = dropStats.map(
    ({ drop, dismissed }) => ({
      key: drop.key,
      parsed: {
        rawBytes: new ArrayBuffer(0),
        rawEmlFile: new File([], drop.fileName),
        messageId: drop.key,
        subject: drop.subject,
        from: { name: drop.sender, address: "" },
        to: [],
        cc: [],
        bcc: [],
        date: null,
        text: null,
        html: null,
        attachments: drop.attachments.map((attachment) => ({
          id: attachment.id,
          filename: attachment.name,
          mimeType: "application/octet-stream",
          size: attachment.size,
          disposition: "attachment" as const,
          related: false,
          contentId: null,
          toFile: () => new File([], attachment.name),
        })),
      },
      bodyDismissed: false,
      dismissedAttachmentIds: new Set(dismissed),
    }),
  );
  const detail: OutlookContextDetailData = {
    threadStaged: null,
    threadVerdicts: new Map(),
    threadExcluded: false,
    threadFile: null,
    drops: stagedDrops,
    dropVerdicts: new Map(),
    dropFiles: new Map(),
    dropSizeLabels: new Map(),
    fallbackSubject: "",
  };
  const models = outlookContextChips(preview, plan, display);
  const { result } = renderHook(() =>
    useOutlookContextItems({
      models,
      handlers,
      detail,
      sending: state.sending,
    }),
  );
  return result.current;
}

/** What a chip and the mode show: the fields the Storybook spec reads. */
function summary({
  items,
  modes,
}: {
  items: ComposerContextItem[];
  modes: ComposerMode[];
}) {
  return {
    chips: items.map((item) => ({
      kind: item.kind,
      origin: item.origin,
      ...(item.origin === "ambient" ? { dismissScope: item.dismissScope } : {}),
      state: item.state,
      ...(item.tone ? { tone: item.tone } : {}),
      label: item.label,
      meta: item.meta ?? null,
      control: item.onRestore
        ? (item.restoreLabel ?? null)
        : item.onRemove
          ? (item.removeLabel ?? null)
          : null,
      ...(item.locked ? { lockReason: item.lockReason ?? null } : {}),
      ...(item.detail?.actions?.length
        ? {
            actions: item.detail.actions.map((action) => ({
              label: action.label,
              announcement: action.announcement ?? null,
            })),
          }
        : {}),
    })),
    modes: modes.map((mode) => ({
      label: mode.label,
      description: mode.description ?? null,
      endLabel: mode.endLabel,
      endedAnnouncement: mode.endedAnnouncement ?? null,
    })),
  };
}

beforeAll(() => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

afterEach(() => {
  cleanup();
});

it("writes the chips the add-in draws for every Outlook story and flow", async () => {
  const stories = Object.fromEntries(
    Object.entries(OUTLOOK_STORIES).map(([name, seed]) => [
      outlookStoryId(name),
      summary(addinContext(outlookStoryState(seed))),
    ]),
  );
  const flows = Object.fromEntries(
    Object.entries(OUTLOOK_STORY_FLOWS).map(([name, flow]) => [
      name,
      {
        story: outlookStoryId(flow.story),
        ...summary(
          addinContext(
            outlookStoryState(OUTLOOK_STORIES[flow.story], flow.then),
          ),
        ),
      },
    ]),
  );
  const json = await format(JSON.stringify({ stories, flows }), {
    parser: "json",
  });
  await expect(json).toMatchFileSnapshot(EXPECTED);
});
