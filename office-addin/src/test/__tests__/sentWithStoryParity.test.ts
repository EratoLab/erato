import path from "node:path";

import { actionFacetEstimate } from "@erato/frontend/library";
import { WORD_COMMENT_THREAD_FACET_ID } from "@erato/frontend/word-review";
import { createCompiledCatalog, getFormat } from "@lingui/cli/api";
import { i18n } from "@lingui/core";
import { format } from "prettier";
import { afterEach, expect, it } from "vitest";

import {
  PARITY_DOCUMENT,
  PARITY_EDIT_STORIES,
  PARITY_FACETS,
  PARITY_SENT_STORIES,
  parityStoryId,
} from "../../../../frontend/src/stories/chat/composerContextParityScenarios";
import { resolveOutlookActionFacet } from "../../outlook/utils/outlookActionFacet";
import { outlookSentWithDescriptors } from "../../outlook/utils/outlookSentWith";
import {
  resolveWordActionFacet,
  resolveWordCommentThreadFacet,
  resolveWordSelectionFacet,
  WORD_AUTHORING_FACET_ID,
  WORD_COMPOSE_FACET_ID,
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_SELECTION_FACET_ID,
} from "../../word/utils/wordActionFacet";
import { readWordComments } from "../../word/utils/wordCommentReader";
import {
  createWordCommentRefRegistry,
  forgetWordCommentRefs,
} from "../../word/utils/wordCommentRefs";
import {
  wordAnchoredCommentsArg,
  wordCommentMapArg,
  wordCommentSendExact,
  wordCommentSendRead,
  wordCommentThreadArgs,
} from "../../word/utils/wordCommentSend";
import { wordSentWithDescriptors } from "../../word/utils/wordSentWith";
import {
  installWordCommentHost,
  uninstallWordCommentHost,
} from "../mocks/word/commentHost";

import type {
  ParityFacetKey,
  ParityFacetRecipe,
} from "../../../../frontend/src/stories/chat/composerContextParityScenarios";
import type { OutlookActionFacetInput } from "../../outlook/utils/outlookActionFacet";
import type { WordCommentSendRead } from "../../word/utils/wordCommentSend";
import type { WordSelectionSnapshot } from "../../word/utils/wordSelectionAnchor";
import type { ActionFacetRequest, SentWithChip } from "@erato/frontend/library";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

// The `Chat/ComposerContextParity` stories draw a sent message's "Sent with"
// row and the edit composer's locked chip from this file: the add-in's own
// resolvers build each story's facet, its own descriptors name it, and the
// library's estimate sizes it. The Storybook spec holds the stories to it.
// After a deliberate change, update the file with
// `pnpm exec vitest run src/test/__tests__/sentWithStoryParity.test.ts -u`.
const GENERATED =
  "../../../../frontend/src/stories/chat/composerContextParity.generated.json";

const WORD_FACETS = new Set([
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_AUTHORING_FACET_ID,
  WORD_COMPOSE_FACET_ID,
  WORD_SELECTION_FACET_ID,
  WORD_COMMENT_THREAD_FACET_ID,
]);
const REVIEW_ONLY = new Set([
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_COMPOSE_FACET_ID,
  WORD_SELECTION_FACET_ID,
]);
const WORD_FACET_ARGS = new Map<string, ReadonlySet<string>>([
  [
    WORD_SELECTION_FACET_ID,
    new Set([
      "document_name",
      "document_identity",
      "selected_text",
      "paragraph_count",
      "truncated",
      "anchored_comments",
    ]),
  ],
  [WORD_DOCUMENT_REVIEW_FACET_ID, new Set(["comment_map", "review_status"])],
  [WORD_AUTHORING_FACET_ID, new Set(["comment_map"])],
  [WORD_COMMENT_THREAD_FACET_ID, new Set(["thread_json", "comments_json"])],
]);
const NOW = new Date("2026-10-12T09:30:00Z");

/** What a sent facet's descriptor is expected to name, so a wrong build fails here. */
const EXPECTED_KIND: Record<ParityFacetKey, string | null> = {
  wordDocumentPartial: "word.document",
  wordDocumentTrackChanges: "word.document",
  wordDocumentLongName: "word.document",
  wordAuthoring: "word.document",
  wordNewDocument: "word.document",
  wordSelection: "word.selection",
  wordSelectionTooLong: "word.selection",
  wordSelectionWithComment: "word.selection",
  wordCommentChosen: "word.comment",
  wordOpenComments: "word.openComments",
  outlookDraft: "outlook.draft",
  outlookAppointment: "outlook.appointment",
  outlookSelection: "outlook.selection",
  outlookScheduling: null,
  unregistered: null,
};

async function commentRead(selection: {
  tag: string;
  offset: number;
}): Promise<WordCommentSendRead> {
  forgetWordCommentRefs();
  const host = installWordCommentHost({ selection });
  const result = await readWordComments({
    selection: true,
    replies: "requested",
    exact: (threads, live) =>
      wordCommentSendExact(threads, { passage: null, live, pickedId: null }),
    now: host.now,
  });
  if (!result.ok) throw new Error(result.error);
  return wordCommentSendRead({
    result,
    registry: createWordCommentRefRegistry("doc"),
    passage: null,
    people: { principalEmail: "maya.kruger@contoso.test" },
    now: NOW,
    userTz: "Europe/Berlin",
  });
}

const reviewArgs = (sent: number, total: number) => ({
  document_text: "1. The Supplier shall deliver the Goods.\n\n".repeat(12),
  heading_outline: "",
  paragraphs_sent: String(sent),
  paragraphs_total: String(total),
  truncation_note: "",
});

const selectionSnapshot = (
  text: string,
  paragraphCount: number,
  truncated: boolean,
): WordSelectionSnapshot => ({
  role: "context_only",
  reasonCode: null,
  shape: "inline",
  story: "main",
  origin: "user",
  selectedText: text,
  truncated,
  paragraphCount,
  paragraphs: [],
  startOffset: 0,
  endOffset: 0,
  occurrence: 0,
  anchor: null,
  contextBefore: "",
  contextAfter: "",
});

const OUTLOOK_COMPOSE: OutlookActionFacetInput = {
  itemKind: "message",
  hasActiveSelection: false,
  selectionData: "",
  selectionSource: "body",
  draftContextIncluded: true,
  draftBody: "",
  lastSentDraftFingerprint: null,
  isComposeMode: true,
  composeEmailAvailable: true,
  isReadMode: false,
  replyFromReadAvailable: true,
  scheduleFacetAvailable: true,
  calendarAvailable: true,
  schedulingThreadActive: false,
  appointmentRewriteAvailable: true,
  appointmentContextAvailable: true,
  availableFacetArgs: new Map([
    ["outlook_review_draft", new Set(["recipients"])],
  ]),
  nowIso: "2026-10-20T09:00:00+02:00",
  timezone: "Europe/Berlin",
};

const recipients = (names: string[]) =>
  JSON.stringify({
    to: names.map((displayName) => ({
      displayName,
      emailAddress: `${displayName.split(" ")[0].toLowerCase()}@contoso.test`,
    })),
    cc: [],
  });

const outlookFacet = (input: Partial<OutlookActionFacetInput>) => {
  const { facet } = resolveOutlookActionFacet({
    ...OUTLOOK_COMPOSE,
    ...input,
  });
  if (!facet) throw new Error("the Outlook resolver sent no facet");
  return facet;
};

const required = (facet: ActionFacetRequest | undefined) => {
  if (!facet) throw new Error("the Word resolver sent no facet");
  return facet;
};

async function buildFacet(
  recipe: ParityFacetRecipe,
): Promise<ActionFacetRequest> {
  switch (recipe.host) {
    case "none":
      return { id: recipe.facetId, args: recipe.args };
    case "outlook":
      switch (recipe.facet) {
        case "draft":
          return outlookFacet({
            draftBody: recipe.body,
            recipients: recipients(recipe.to),
          });
        case "appointment":
          return outlookFacet({
            itemKind: "appointment",
            draftBody: recipe.body,
            appointmentSubject: recipe.subject,
            appointmentStart: recipe.start,
            appointmentEnd: recipe.end,
            timezone: recipe.timezone,
          });
        case "selection":
          return outlookFacet({
            draftBody: recipe.draft,
            hasActiveSelection: true,
            selectionData: recipe.text,
          });
        case "schedule":
          return outlookFacet({
            schedulingThreadActive: true,
            draftContextIncluded: false,
          });
      }
      break;
    case "word":
      switch (recipe.facet) {
        case "review": {
          const commentMap = recipe.commentMap
            ? wordCommentMapArg(
                await commentRead({ tag: "END", offset: 0 }),
                [],
              )
            : undefined;
          return required(
            resolveWordActionFacet({
              chipEnabled: true,
              documentName: recipe.documentName ?? PARITY_DOCUMENT,
              documentIdentity: "doc-1",
              documentArgs: reviewArgs(recipe.sent, recipe.total),
              hasContent: true,
              availableFacetIds: recipe.trackChanges
                ? REVIEW_ONLY
                : WORD_FACETS,
              availableFacetArgs: WORD_FACET_ARGS,
              trackChanges: recipe.trackChanges,
              commentMap,
            }),
          );
        }
        case "authoring":
          return required(
            resolveWordActionFacet({
              chipEnabled: true,
              documentName: PARITY_DOCUMENT,
              documentIdentity: "doc-1",
              documentArgs: reviewArgs(recipe.total, recipe.total),
              hasContent: true,
              authoring: { token: "snapshot-1" } as WordAuthoringSnapshot,
              availableFacetIds: WORD_FACETS,
              availableFacetArgs: WORD_FACET_ARGS,
            }),
          );
        case "compose":
          return required(
            resolveWordActionFacet({
              chipEnabled: true,
              documentName: PARITY_DOCUMENT,
              documentIdentity: "doc-1",
              documentArgs: reviewArgs(0, 0),
              hasContent: false,
              availableFacetIds: WORD_FACETS,
              availableFacetArgs: WORD_FACET_ARGS,
            }),
          );
        case "selection": {
          let anchoredComments: string | undefined;
          if (recipe.comments) {
            const read = await commentRead({ tag: "T1P", offset: 22 });
            anchoredComments = wordAnchoredCommentsArg(
              read,
              read.model.threads.slice(0, 1).map(({ thread }) => thread.id),
            );
          }
          return required(
            resolveWordSelectionFacet({
              selection: selectionSnapshot(
                recipe.text,
                recipe.paragraphs,
                recipe.truncated ?? false,
              ),
              documentName: PARITY_DOCUMENT,
              documentIdentity: "doc-1",
              availableFacetIds: WORD_FACETS,
              availableFacetArgs: WORD_FACET_ARGS,
              anchoredComments,
            }),
          );
        }
        case "comment":
        case "openComments": {
          const read = await commentRead({ tag: "END", offset: 0 });
          const { threadJson, commentsJson } =
            recipe.facet === "comment"
              ? wordCommentThreadArgs(
                  read,
                  read.model.threads[0].thread.id,
                  recipe.why,
                )
              : wordCommentThreadArgs(read, null, null);
          return required(
            resolveWordCommentThreadFacet({
              documentName: PARITY_DOCUMENT,
              documentIdentity: "doc-1",
              threadJson,
              commentsJson,
              availableFacetIds: WORD_FACETS,
              availableFacetArgs: WORD_FACET_ARGS,
            }),
          );
        }
      }
  }
  throw new Error(`no facet for ${JSON.stringify(recipe)}`);
}

const DESCRIPTORS = {
  ...wordSentWithDescriptors,
  ...outlookSentWithDescriptors,
};

// The add-in's own catalog: a `.po` import here would resolve through the
// frontend's Lingui config, which the vitest plugin is pointed at.
async function addinCatalog(locale: string) {
  const file = path.resolve(process.cwd(), `src/locales/${locale}/messages.po`);
  const po = await getFormat("po", {}, "en");
  const catalog = (await po.read(file, locale)) ?? {};
  const { source, errors } = createCompiledCatalog(
    locale,
    Object.fromEntries(
      Object.entries(catalog).map(([id, entry]) => [
        id,
        entry.translation || entry.message || id,
      ]),
    ),
    { namespace: "json" },
  );
  expect(errors).toEqual([]);
  return (JSON.parse(source) as { messages: Messages }).messages;
}

type Messages = Parameters<typeof i18n.load>[1];

/** What the host's descriptor names, per locale; null where it names nothing. */
function chipsByLocale(
  facet: ActionFacetRequest,
  locales: Record<string, Messages>,
) {
  const out: Record<string, readonly SentWithChip[] | null> = {};
  for (const [locale, messages] of Object.entries(locales)) {
    i18n.loadAndActivate({ locale, messages });
    const descriptor = DESCRIPTORS[facet.id];
    out[locale] = descriptor ? descriptor(facet.args ?? {}) : null;
  }
  return out;
}

afterEach(() => {
  uninstallWordCommentHost();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

it("writes what every parity story's sent context draws", async () => {
  const locales = {
    en: await addinCatalog("en"),
    de: await addinCatalog("de"),
  };
  const facets: Record<string, unknown> = {};
  for (const [key, recipe] of Object.entries(PARITY_FACETS) as [
    ParityFacetKey,
    ParityFacetRecipe,
  ][]) {
    const facet = await buildFacet(recipe);
    const chips = chipsByLocale(facet, locales);
    const kind = EXPECTED_KIND[key];
    for (const [locale, list] of Object.entries(chips)) {
      if (kind === null) {
        expect(list ?? [], `${key} (${locale})`).toEqual([]);
      } else {
        expect(
          list?.map((chip) => chip.kind),
          `${key} (${locale})`,
        ).toEqual([kind]);
        expect(list?.[0].label, `${key} (${locale})`).toBeTruthy();
      }
    }
    facets[key] = {
      facet: { id: facet.id, args: facet.args ?? {} },
      registered: facet.id in DESCRIPTORS,
      chips,
      estimateBytes: actionFacetEstimate(facet).size,
    };
  }

  const stories = {
    ...Object.fromEntries(
      Object.entries(PARITY_SENT_STORIES).map(([name, story]) => [
        name,
        { id: parityStoryId(name), kind: "sent", ...story },
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(PARITY_EDIT_STORIES).map(([name, story]) => [
        name,
        { id: parityStoryId(name), kind: "edit", ...story },
      ]),
    ),
  };

  const json = await format(JSON.stringify({ facets, stories }), {
    parser: "json",
  });
  await expect(json).toMatchFileSnapshot(GENERATED);
});
