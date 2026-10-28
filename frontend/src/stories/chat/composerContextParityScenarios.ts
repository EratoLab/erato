/*
 * What the `Chat/ComposerContextParity` stories send, in the add-in's own
 * terms: which document, passage, comment, draft or appointment went with a
 * message. No imports, so the add-in's parity test
 * (office-addin/src/test/__tests__/sentWithStoryParity.test.ts) can build each
 * facet with the add-in's real resolvers, run its real sent-with descriptors
 * and the library's estimate on it, and write what each story draws to
 * composerContextParity.generated.json.
 */

export const PARITY_DOCUMENT = "Supply agreement.docx";

const PASSAGE =
  "The Supplier shall deliver the Goods no later than the delivery dates set out in Schedule 2. Partial deliveries require the Buyer's prior written consent.";

const LONG_PASSAGE =
  "Schedule 2 sets out the delivery plan for every site in scope, including the staging of partial deliveries, the acceptance procedure, the documents that must accompany each shipment and the remedies available to the Buyer if a milestone is missed. "
    .repeat(6)
    .trim();

const DRAFT =
  "Hi Anna,\n\nthanks for the updated contract. Could you confirm the delivery date by Friday? We also need the revised pricing sheet before the steering meeting.\n\nBest regards,\nSam";

/** A facet as the add-in would build it at send time. */
export type ParityFacetRecipe =
  | {
      host: "word";
      facet: "review";
      sent: number;
      total: number;
      documentName?: string;
      /** The request carried the document's comment map. */
      commentMap?: boolean;
      trackChanges?: boolean;
    }
  | { host: "word"; facet: "authoring"; total: number }
  | { host: "word"; facet: "compose" }
  | {
      host: "word";
      facet: "selection";
      text: string;
      paragraphs: number;
      truncated?: boolean;
      /** The passage's comment went with it. */
      comments?: boolean;
    }
  | { host: "word"; facet: "comment"; why: "chosen" | "cursor" }
  | { host: "word"; facet: "openComments" }
  | { host: "outlook"; facet: "draft"; body: string; to: string[] }
  | {
      host: "outlook";
      facet: "appointment";
      subject: string;
      body: string;
      start: string;
      end: string;
      timezone: string;
    }
  | { host: "outlook"; facet: "selection"; draft: string; text: string }
  | { host: "outlook"; facet: "schedule" }
  /** A facet no host registered a descriptor for; it carries a quote only. */
  | { host: "none"; facetId: string; args: Record<string, string> };

export const PARITY_FACETS = {
  wordDocumentPartial: {
    host: "word",
    facet: "review",
    sent: 120,
    total: 300,
    commentMap: true,
  },
  wordDocumentTrackChanges: {
    host: "word",
    facet: "review",
    sent: 86,
    total: 86,
    trackChanges: true,
  },
  wordDocumentLongName: {
    host: "word",
    facet: "review",
    sent: 86,
    total: 86,
    documentName:
      "Master supply and logistics framework agreement between Contoso GmbH and Fabrikam Industrial Components AG, revision 14 (clean).docx",
  },
  wordAuthoring: { host: "word", facet: "authoring", total: 86 },
  wordNewDocument: { host: "word", facet: "compose" },
  wordSelection: {
    host: "word",
    facet: "selection",
    text: PASSAGE,
    paragraphs: 2,
  },
  wordSelectionTooLong: {
    host: "word",
    facet: "selection",
    text: LONG_PASSAGE,
    paragraphs: 14,
    truncated: true,
  },
  wordSelectionWithComment: {
    host: "word",
    facet: "selection",
    text: "Payment is due within 30 days of the invoice date. Late payments bear interest at the statutory rate.",
    paragraphs: 1,
    comments: true,
  },
  wordCommentChosen: { host: "word", facet: "comment", why: "chosen" },
  wordOpenComments: { host: "word", facet: "openComments" },
  outlookDraft: {
    host: "outlook",
    facet: "draft",
    body: DRAFT,
    to: ["Anna Weber", "Tom Fischer", "Priya Raman"],
  },
  outlookAppointment: {
    host: "outlook",
    facet: "appointment",
    subject: "Steering committee: vendor renewal",
    body: "Agenda: renewal terms, delivery dates, pricing sheet.",
    start: "2026-10-23T10:00:00+02:00",
    end: "2026-10-23T11:00:00+02:00",
    timezone: "Europe/Berlin",
  },
  outlookSelection: {
    host: "outlook",
    facet: "selection",
    draft: DRAFT,
    text: "Could you confirm the delivery date by Friday?",
  },
  outlookScheduling: { host: "outlook", facet: "schedule" },
  unregistered: {
    host: "none",
    facetId: "sheet_rewrite_selection",
    args: { selected_text: "Q3 revenue: 4.2 M EUR (+8 % year on year)" },
  },
} satisfies Record<string, ParityFacetRecipe>;

export type ParityFacetKey = keyof typeof PARITY_FACETS;

/** A sent user message and the facet it carried. */
export interface ParitySentStory {
  facet: ParityFacetKey;
  text: string;
}

export const PARITY_SENT_STORIES = {
  SentWithWordDocument: {
    facet: "wordDocumentPartial",
    text: "Summarise the obligations of the Supplier.",
  },
  SentWithWordTrackChanges: {
    facet: "wordDocumentTrackChanges",
    text: "Which changes are still open?",
  },
  SentWithWordAuthoring: {
    facet: "wordAuthoring",
    text: "Tighten the wording of clause 4.",
  },
  SentWithWordNewDocument: {
    facet: "wordNewDocument",
    text: "Draft a cover letter for the agreement.",
  },
  SentWithWordSelection: {
    facet: "wordSelection",
    text: "Make this passage stricter.",
  },
  SentWithWordSelectionTooLong: {
    facet: "wordSelectionTooLong",
    text: "Shorten this schedule.",
  },
  SentWithWordSelectionComment: {
    facet: "wordSelectionWithComment",
    text: "Answer the comment on this passage.",
  },
  SentWithWordComment: {
    facet: "wordCommentChosen",
    text: "Suggest a reply to this comment.",
  },
  SentWithWordOpenComments: {
    facet: "wordOpenComments",
    text: "Which comments still need an answer?",
  },
  SentWithOutlookDraft: {
    facet: "outlookDraft",
    text: "Make my draft more polite.",
  },
  SentWithOutlookAppointment: {
    facet: "outlookAppointment",
    text: "Write an agenda for this meeting.",
  },
  SentWithOutlookSelection: {
    facet: "outlookSelection",
    text: "Rephrase this sentence.",
  },
  SentWithOutlookScheduling: {
    facet: "outlookScheduling",
    text: "Find a slot next week.",
  },
  SentWithUnregistered: {
    facet: "unregistered",
    text: "Explain this number.",
  },
  SentWithLongNames: {
    facet: "wordDocumentLongName",
    text: "Summarise the obligations of the Supplier.",
  },
} satisfies Record<string, ParitySentStory>;

export type ParitySentStoryName = keyof typeof PARITY_SENT_STORIES;

/** A Teams transcript a sent message carries, by its picker conversations. */
export interface ParityEditTranscript {
  conversations: ("product" | "design" | "grace")[];
  /** The stored read never settles. */
  pending?: boolean;
  /** The stored file has no index block. */
  unreadable?: boolean;
}

/** A sent message opened in the editor: its files, its facet, what the host reports. */
export interface ParityEditStory {
  text: string;
  transcript?: ParityEditTranscript;
  facet?: ParityFacetKey;
  /** The user's own files, by name. */
  files?: string[];
  /** The server no longer offers the facet, so the edit does not send it again. */
  facetUnavailable?: boolean;
  /** A component kit's chip face and attachment preview are installed. */
  kit?: boolean;
}

export const PARITY_EDIT_STORIES = {
  EditTeamsTranscript: {
    text: "Compare the two supplier quotes with what the team said in Product sync.",
    transcript: { conversations: ["product"] },
    files: ["supplier-quote-a.pdf", "supplier-quote-b.pdf"],
  },
  EditTeamsReading: {
    text: "What did the team decide?",
    transcript: { conversations: ["product"], pending: true },
    files: ["supplier-quote-a.pdf"],
  },
  EditTeamsUnreadable: {
    text: "What did the team decide?",
    transcript: { conversations: ["product"], unreadable: true },
    files: ["supplier-quote-a.pdf"],
  },
  EditWordSelection: {
    text: "Make this passage stricter.",
    facet: "wordSelection",
    files: ["delivery-terms.pdf"],
  },
  EditWordDocument: {
    text: "Summarise the obligations of the Supplier.",
    facet: "wordDocumentPartial",
    files: ["delivery-terms.pdf"],
  },
  EditOutlookDraft: {
    text: "Make my draft more polite.",
    facet: "outlookDraft",
    files: ["pricing-sheet.pdf", "contract-v3.pdf"],
  },
  EditFacetUnavailable: {
    text: "Make this passage stricter.",
    facet: "wordSelection",
    files: ["delivery-terms.pdf"],
    facetUnavailable: true,
  },
  EditKitOverride: {
    text: "Compare the two supplier quotes with what the team said in Product sync.",
    transcript: { conversations: ["product"] },
    files: ["supplier-quote-a.pdf", "supplier-quote-b.pdf"],
    kit: true,
  },
  EditManyFiles: {
    text: "Check every quote against what the team agreed.",
    transcript: { conversations: ["product", "design", "grace"] },
    files: [
      "supplier-quote-a.pdf",
      "supplier-quote-b.pdf",
      "supplier-quote-c.pdf",
      "pricing-sheet.pdf",
      "contract-v3.pdf",
      "risk-register.pdf",
    ],
  },
} satisfies Record<string, ParityEditStory>;

export type ParityEditStoryName = keyof typeof PARITY_EDIT_STORIES;

export const parityStoryId = (name: string) =>
  `chat-composercontextparity--${name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()}`;
