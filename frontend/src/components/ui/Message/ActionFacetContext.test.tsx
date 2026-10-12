import { i18n } from "@lingui/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ActionFacetContext } from "./ActionFacetContext";

import type {
  WordCommentCoverage,
  WordCommentEnvelope,
  WordCommentMapRow,
  WordCommentThread,
} from "@/lib/wordReview/wordCommentContext";

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});
afterEach(cleanup);

const quote = () => screen.getByText("Selection").nextElementSibling!;

describe("ActionFacetContext", () => {
  it("keeps the selection's paragraph breaks", () => {
    render(
      <ActionFacetContext
        actionFacetArgs={{ selected_text: "First paragraph.\nSecond one." }}
      />,
    );

    expect(quote().textContent).toBe("First paragraph.\nSecond one.");
    expect(quote()).toHaveClass("whitespace-pre-line");
  });

  it("labels the markers kept_items explains", () => {
    render(
      <ActionFacetContext
        actionFacetArgs={{
          selected_text: "See ⟦1⟧link⟦/1⟧ on ⟦2⟧.",
          kept_items: [
            "⟦1⟧…⟦/1⟧ a link around the text between; that text may change",
            '⟦2⟧ a field showing "2026-10-10"',
          ].join("\n"),
        }}
      />,
    );

    expect(quote().textContent).toBe("See [link]link[/link] on [2026-10-10].");
  });

  it("labels a format span by the emphasis kept_items gives it", () => {
    render(
      <ActionFacetContext
        actionFacetArgs={{
          selected_text: "A ⟦1⟧bold⟦/1⟧ and ⟦2⟧odd⟦/2⟧ ⟦3⟧link⟦/3⟧.",
          kept_items: [
            "⟦1⟧…⟦/1⟧ formatting: bold, not italic",
            "⟦2⟧…⟦/2⟧ formatting: wavy",
            "⟦3⟧…⟦/3⟧ a link around the text between; that text may change",
          ].join("\n"),
        }}
      />,
    );

    expect(quote().textContent).toBe(
      "A [bold, not italic]bold[/bold, not italic] and [wavy]odd[/wavy] [link]link[/link].",
    );
  });

  it("leaves the text alone without kept_items", () => {
    render(
      <ActionFacetContext actionFacetArgs={{ selected_text: "Plain ⟦1⟧." }} />,
    );

    expect(quote().textContent).toBe("Plain ⟦1⟧.");
  });
});

const inPassage: WordCommentThread = {
  id: "t7k",
  pos: 4,
  status: "open",
  where: {
    para: 12,
    quote: "Lieferung binnen 14 Tagen",
    vs: "inside",
    in: "body",
  },
  first_at: "2026-10-02T09:14Z",
  last_at: "2026-10-03T11:02Z",
  entries: [
    {
      n: 0,
      by: "Jonas Weber",
      at: "2026-10-02T09:14Z",
      age: 1,
      day: "2026-10-02",
      text: "Ist 14 Tage realistisch?",
    },
    {
      n: 4,
      by: "Maya Krüger",
      at: "2026-10-03T11:02Z",
      age: 3,
      day: "2026-10-03",
      text: "Eher 21 Tage.\nSiehe Anlage.",
    },
  ],
  omitted_replies: 3,
};

const resolvedPoint: WordCommentThread = {
  id: "t9m",
  pos: 5,
  status: "resolved",
  where: { para: 13, quote: "", point: true, vs: "inside", in: "body" },
  first_at: null,
  last_at: null,
  entries: [
    {
      n: 0,
      by: "Maya Krüger",
      at: null,
      age: null,
      day: null,
      text: "Datum fehlt.",
    },
  ],
  matched_by_content: true,
};

const mapRows: WordCommentMapRow[] = [
  {
    id: "t1a",
    sec: "2 Zahlung > 2.1 Fristen",
    para: 2,
    q: "Haftung",
    by: "Jonas Weber",
    st: "resolved",
    r: 2,
    at: "2026-10-01T08:00Z",
    g: "Haftung auf Vorsatz begrenzen?",
  },
  { id: "t3x", para: 7, by: "Lena Hoffmann", st: "open", r: null, at: null },
];

const coverage = (
  changes: Partial<WordCommentCoverage> = {},
): WordCommentCoverage => ({
  threads_total: 9,
  open: 7,
  resolved: 2,
  sent_full: 2,
  sent_index_only: 0,
  not_shown: 7,
  cut: { texts: 0, replies: 0 },
  complete: false,
  line: "9 comment threads in the document (7 open, 2 resolved): 2 sent with their text, 0 listed without text, 7 not shown.",
  ...changes,
});

const envelope = (
  changes: Partial<WordCommentEnvelope> = {},
): WordCommentEnvelope => ({
  v: 1,
  scope: "selection",
  now: "2026-10-12T08:30Z",
  user_tz: "Europe/Berlin",
  selection: { para: [12, 13], caret: false },
  coverage: coverage(),
  threads: [inPassage, resolvedPoint],
  index: [],
  ...changes,
});

const json = (value: unknown) => JSON.stringify(value);
const sentContext = () => screen.queryByTestId("word-comment-sent-context");
const showComments = () =>
  fireEvent.click(screen.getByRole("button", { name: "Show comments" }));
const when = (iso: string) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));

describe("ActionFacetContext with Word comments", () => {
  it("names the passage and its comments under the selection", () => {
    render(
      <ActionFacetContext
        actionFacetArgs={{
          selected_text: "Lieferung binnen 14 Tagen.",
          anchored_comments: json(envelope()),
        }}
      />,
    );

    expect(quote().textContent).toBe("Lieferung binnen 14 Tagen.");
    expect(sentContext()).toHaveTextContent(
      "Sent context: Selected passage · 2 comments",
    );
    expect(screen.queryByText("Ist 14 Tage realistisch?")).toBeNull();
  });

  it("shows the sent threads read-only behind a toggle", () => {
    render(
      <ActionFacetContext
        actionFacetArgs={{
          selected_text: "Lieferung binnen 14 Tagen.",
          anchored_comments: json(envelope()),
        }}
      />,
    );
    showComments();

    const [first, second] = screen.getAllByTestId("word-comment-thread");
    expect(first).toHaveTextContent("Open · on “Lieferung binnen 14 Tagen”");
    const entries = within(first).getAllByTestId("word-comment-entry");
    expect(entries.map((entry) => entry.textContent)).toEqual([
      `Jonas Weber · ${when("2026-10-02T09:14Z")}Ist 14 Tage realistisch?`,
      `Maya Krüger · ${when("2026-10-03T11:02Z")}Eher 21 Tage.\nSiehe Anlage.`,
    ]);
    expect(first).toHaveTextContent("3 earlier replies were not sent");
    expect(second).toHaveTextContent(
      "Resolved · on a spot without highlighted text · matched by content",
    );
    expect(second).toHaveTextContent("Maya Krüger · time unknown");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Hide comments" }));
    expect(screen.queryByTestId("word-comment-thread")).toBeNull();
  });

  it.each([
    ["chosen", "Chosen by you"],
    ["cursor", "At your cursor"],
    ["default", "Your default"],
  ] as const)("names the comment it worked on and why (%s)", (why, label) => {
    render(
      <ActionFacetContext
        actionFacetArgs={{
          document_name: "Vertrag.docx",
          thread_json: json(inPassage),
          comments_json: json(
            envelope({ scope: "thread", threads: [inPassage], why }),
          ),
        }}
      />,
    );

    expect(sentContext()).toHaveTextContent(
      `Sent context: Comment by Jonas Weber · 4 replies · ${label}`,
    );
    showComments();
    expect(screen.getAllByTestId("word-comment-thread")).toHaveLength(1);
  });

  it("names a thread without replies or a why as just its author", () => {
    render(
      <ActionFacetContext
        actionFacetArgs={{ thread_json: json(resolvedPoint) }}
      />,
    );

    expect(sentContext()?.firstChild).toHaveTextContent(
      /^Sent context: Comment by Maya Krüger\s*Show comments$/,
    );
  });

  it("counts the open comments Include open comments sent, without the resolved ones", () => {
    render(
      <ActionFacetContext
        actionFacetArgs={{
          thread_json: "",
          comments_json: json(
            envelope({
              scope: "document",
              selection: undefined,
              threads: [inPassage],
              index: [mapRows[1]],
              coverage: coverage({ sent_full: 1, sent_index_only: 1 }),
            }),
          ),
        }}
      />,
    );

    expect(sentContext()).toHaveTextContent(
      "Sent context: Open comments · 2 comments · 5 not shown",
    );
  });

  it("names the comment map with the threads it listed and left out", () => {
    render(
      <ActionFacetContext
        actionFacetArgs={{
          document_name: "Vertrag.docx",
          comment_map: json(
            envelope({
              scope: "document",
              selection: undefined,
              threads: [],
              index: mapRows,
              coverage: coverage({
                sent_full: 0,
                sent_index_only: 2,
                not_shown: 3,
              }),
              cursor: "map:2",
            }),
          ),
        }}
      />,
    );

    expect(sentContext()).toHaveTextContent(
      "Sent context: Comment map · 2 threads · 3 not shown",
    );
    showComments();
    const [listed, bare] = screen.getAllByTestId("word-comment-map-row");
    expect(listed).toHaveTextContent(
      `Jonas Weber · Resolved · 2 replies · ${when("2026-10-01T08:00Z")}`,
    );
    expect(listed).toHaveTextContent("2 Zahlung > 2.1 Fristen");
    expect(listed).toHaveTextContent("on “Haftung”");
    expect(listed).toHaveTextContent("Haftung auf Vorsatz begrenzen?");
    expect(bare.textContent).toBe("Lena Hoffmann · Open · time unknown");
  });

  it("shows no comment line for a passage without comments", () => {
    render(
      <ActionFacetContext
        actionFacetArgs={{
          selected_text: "Plain text.",
          anchored_comments: json(
            envelope({
              threads: [],
              coverage: coverage({ sent_full: 0, not_shown: 9 }),
            }),
          ),
        }}
      />,
    );

    expect(quote().textContent).toBe("Plain text.");
    expect(sentContext()).toBeNull();
  });

  it.each([
    ["anchored_comments", "{not json"],
    ["comment_map", json({ ...envelope(), v: 2 })],
    ["thread_json", json({ ...inPassage, id: "7" })],
  ])("ignores a malformed %s", (key, value) => {
    const { container } = render(
      <ActionFacetContext actionFacetArgs={{ [key]: value }} />,
    );
    expect(container).toBeEmptyDOMElement();

    cleanup();
    render(
      <ActionFacetContext
        actionFacetArgs={{ selected_text: "Still here.", [key]: value }}
      />,
    );
    expect(quote().textContent).toBe("Still here.");
    expect(sentContext()).toBeNull();
  });
});
