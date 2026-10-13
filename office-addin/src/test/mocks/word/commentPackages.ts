import { escapeXml } from "../../../utils/escapeXml";

/**
 * Hand-built getOoxml() packages modelled on the ERMAIN-947 fixture v3c-comments.docx
 * (erato-word-benchmarks, fixtures/v3c), with its ids, dates and anchors from ground-truth.json.
 * Packages number their comments afresh from 0 in document order, tracked changes included, as
 * Word's paragraph packages did in the probe (T1P: 0, 1, 2; T9P: the deletion 0, the comment 1).
 */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
const W16CID = "http://schemas.microsoft.com/office/word/2016/wordml/cid";
const W16CEX = "http://schemas.microsoft.com/office/word/2018/wordml/cex";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const WML = "application/vnd.openxmlformats-officedocument.wordprocessingml";

export interface V3cComment {
  paraId: string;
  durableId: string;
  author: string;
  initials: string;
  date: string;
  dateUtc: string | null;
  done: boolean;
  parent?: string;
  content: string;
}

const MK = { author: "Maya Krüger", initials: "MK" };
const JW = { author: "Jonas Weber", initials: "JW" };
const LF = { author: "Lena Fischer", initials: "LF" };

export const V3C_COMMENTS: Readonly<Record<string, V3cComment>> = {
  T1: {
    ...MK,
    paraId: "08CBE9DD",
    durableId: "4F6559BD",
    date: "2026-09-03T10:15:30Z",
    dateUtc: "2026-09-03T08:15:30Z",
    done: false,
    content: "T1 root: please check the alpha bravo wording.",
  },
  R1a: {
    ...JW,
    paraId: "4F5A106E",
    durableId: "07633064",
    date: "2026-09-03T05:20:11Z",
    dateUtc: "2026-09-03T09:20:11Z",
    done: false,
    parent: "T1",
    content: "T1 reply A: agreed, alpha bravo is unclear.",
  },
  R1b: {
    ...MK,
    paraId: "69FF5789",
    durableId: "57099875",
    date: "2026-09-04T09:00:45Z",
    dateUtc: "2026-09-04T07:00:45Z",
    done: false,
    parent: "T1",
    content: "T1 reply B: changed my mind, keep it.",
  },
  T2: {
    ...JW,
    paraId: "5941719E",
    durableId: "2D6621E6",
    date: "2026-09-01T16:45:00Z",
    dateUtc: "2026-09-01T20:45:00Z",
    done: true,
    content: "T2 root: delta echo is fine now.",
  },
  R2a: {
    ...LF,
    paraId: "4B61C7E3",
    durableId: "4CF3D15F",
    date: "2026-09-02T10:00:05Z",
    dateUtc: "2026-09-02T01:00:05Z",
    done: true,
    parent: "T2",
    content: "T2 reply: resolved, thanks.",
  },
  T3: {
    ...LF,
    paraId: "5A4EF942",
    durableId: "580E3756",
    date: "2026-09-05T18:30:00Z",
    dateUtc: "2026-09-05T09:30:00Z",
    done: false,
    content: "T3 root: this spans three paragraphs.",
  },
  T4: {
    ...MK,
    paraId: "33A7A56B",
    durableId: "5E34B2FB",
    date: "2026-09-02T14:00:00Z",
    dateUtc: "2026-09-02T12:00:00Z",
    done: false,
    content: "T4 root: cell anchor india juliet.",
  },
  T5: {
    ...JW,
    paraId: "0EC7F3D2",
    durableId: "58CCD13A",
    date: "2026-09-06T08:00:00Z",
    dateUtc: null,
    done: false,
    content: "T5 root: point comment after kilo.",
  },
  T6: {
    ...MK,
    paraId: "7E7E06A5",
    durableId: "015377C3",
    date: "2026-09-07T11:11:11Z",
    dateUtc: "2026-09-07T09:11:11Z",
    done: false,
    content: "T6 root: outer lima to oscar.",
  },
  T7: {
    ...JW,
    paraId: "611349D6",
    durableId: "5CB44C0A",
    date: "2026-09-07T03:03:03Z",
    dateUtc: "2026-09-07T07:03:03Z",
    done: false,
    content: "T7 root: nested mike november.",
  },
  T7b: {
    ...LF,
    paraId: "7FE54E0F",
    durableId: "3AB9863D",
    date: "2026-09-07T20:20:20Z",
    dateUtc: "2026-09-07T11:20:20Z",
    done: false,
    content: "T7b root: overlap oscar papa quebec.",
  },
  T8: {
    ...MK,
    paraId: "164C9FC8",
    durableId: "7610204E",
    date: "2026-08-30T09:30:00Z",
    dateUtc: "2026-08-30T07:30:00Z",
    done: false,
    content: "T8 root: the second sierra tango.",
  },
  T9: {
    ...JW,
    paraId: "33B6CA2B",
    durableId: "3CC110E9",
    date: "2026-09-08T12:30:00Z",
    dateUtc: "2026-09-08T16:30:00Z",
    done: false,
    content: "T9 root: uniform victor after a deletion.",
  },
  T10: {
    ...LF,
    paraId: "293E762A",
    durableId: "243C027E",
    date: "2026-09-08T23:59:59Z",
    dateUtc: "2026-09-08T14:59:59Z",
    done: false,
    content: "T10 root: whiskey xray after hidden text.",
  },
  T11: {
    ...MK,
    paraId: "5FFD5573",
    durableId: "0E4EB641",
    date: "2026-09-09T12:00:00Z",
    dateUtc: "2026-09-09T10:00:00Z",
    done: false,
    content: "T11 root: see this point and the spec.",
  },
  PB1: {
    ...MK,
    paraId: "3668507B",
    durableId: "46427C89",
    date: "2026-09-14T10:00:00Z",
    dateUtc: "2026-09-14T08:00:00Z",
    done: false,
    content: "PB1 root: anchor in a paragraph with a page break.",
  },
  T14: {
    ...JW,
    paraId: "0570A622",
    durableId: "75E2140A",
    date: "2026-09-15T10:00:00Z",
    dateUtc: "2026-09-15T14:00:00Z",
    done: false,
    content: "T14 root: anchor across two table cells.",
  },
};

/** String(Comment.id): the decimal durableId (ground-truth.json durableIdDecimal). */
export const v3cCommentId = (key: string) =>
  String(parseInt(V3C_COMMENTS[key].durableId, 16));

/** ground-truth.json anchors: visible offsets in the first and last paragraph. */
export const V3C_ANCHORS: Readonly<
  Record<string, { tag: string; endTag: string; start: number; end: number }>
> = {
  T1: { tag: "T1P", endTag: "T1P", start: 22, end: 33 },
  T2: { tag: "T2P", endTag: "T2P", start: 23, end: 33 },
  T3: { tag: "T3A", endTag: "T3C", start: 25, end: 13 },
  T4: { tag: "T4C", endTag: "T4C", start: 16, end: 28 },
  T5: { tag: "T5P", endTag: "T5P", start: 28, end: 28 },
  T6: { tag: "T6P", endTag: "T6P", start: 12, end: 36 },
  T7: { tag: "T6P", endTag: "T6P", start: 17, end: 30 },
  T7b: { tag: "T6P", endTag: "T6P", start: 31, end: 48 },
  T8: { tag: "T8P", endTag: "T8P", start: 38, end: 50 },
  T9: { tag: "T9P", endTag: "T9P", start: 19, end: 33 },
  T10: { tag: "T10P", endTag: "T10P", start: 12, end: 24 },
  T11: { tag: "T11P", endTag: "T11P", start: 26, end: 37 },
  PB1: { tag: "PB1", endTag: "PB1", start: 26, end: 35 },
  T14: { tag: "XC1", endTag: "XC2", start: 15, end: 18 },
};

type Segment =
  | string
  | { hidden: string }
  | { del: string }
  | { pageBreak: true }
  /** Start marks of a thread: the root, then its replies. */
  | { cs: string }
  /** End marks and reference runs of a thread. */
  | { ce: string }
  /** A reference alone. */
  | { point: string };

export const V3C_PARAGRAPHS: Readonly<Record<string, readonly Segment[]>> = {
  T1P: [
    "T1P Thread one anchor ",
    { cs: "T1" },
    "alpha bravo",
    { ce: "T1" },
    " charlie.",
  ],
  T2P: [
    "T2P Resolved thread on ",
    { cs: "T2" },
    "delta echo",
    { ce: "T2" },
    " here.",
  ],
  T3A: ["T3A First span paragraph ", { cs: "T3" }, "foxtrot."],
  T3B: ["T3B Middle span paragraph golf."],
  T3C: ["T3C Last span", { ce: "T3" }, " paragraph hotel."],
  T4C: [
    "T4C Cell anchor ",
    { cs: "T4" },
    "india juliet",
    { ce: "T4" },
    " here.",
  ],
  CI1: ["CI1 Cell insert target november oscar."],
  T5P: ["T5P Point comment after kilo", { point: "T5" }, " and more words."],
  T6P: [
    "T6P Overlap ",
    { cs: "T6" },
    "lima ",
    { cs: "T7" },
    "mike november",
    { ce: "T7" },
    " ",
    { cs: "T7b" },
    "oscar",
    { ce: "T6" },
    " papa quebec",
    { ce: "T7b" },
    " romeo.",
  ],
  T8P: [
    "T8P The sierra tango phrase and again ",
    { cs: "T8" },
    "sierra tango",
    { ce: "T8" },
    " here.",
  ],
  T9P: [
    "T9P Tracked before ",
    { del: "removed words " },
    { cs: "T9" },
    "uniform victor",
    { ce: "T9" },
    " after.",
  ],
  T10P: [
    "T10P Hidden ",
    { hidden: "SECRET " },
    { cs: "T10" },
    "whiskey xray",
    { ce: "T10" },
    " end.",
  ],
  T11P: [
    "T11P Formatted comment on ",
    { cs: "T11" },
    "yankee zulu",
    { ce: "T11" },
    " here.",
  ],
  PB1: [
    "PB1 Page break ",
    { pageBreak: true },
    "before the ",
    { cs: "PB1" },
    "anchor pb",
    { ce: "PB1" },
    " words.",
  ],
  XC1: ["XC1 Cross cell ", { cs: "T14" }, "start sigma"],
  XC2: ["XC2 Cross cell end", { ce: "T14" }, " tau."],
};

export type V3cHost = "desktop" | "web";

const threadOf = (key: string) => [
  key,
  ...Object.keys(V3C_COMMENTS).filter((k) => V3C_COMMENTS[k].parent === key),
];

const run = (text: string, rPr = "") =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;

const keyOf = (segment: Segment) =>
  typeof segment === "string"
    ? null
    : "cs" in segment
      ? segment.cs
      : "ce" in segment
        ? segment.ce
        : "point" in segment
          ? segment.point
          : null;

/** Threads with both ends in these paragraphs; Word leaves the others' marks out of a package. */
function containedThreads(tags: readonly string[]): Set<string> {
  const starts = new Set<string>();
  const ends = new Set<string>();
  for (const segment of tags.flatMap((tag) => V3C_PARAGRAPHS[tag])) {
    const key = keyOf(segment);
    if (!key || typeof segment === "string") continue;
    if (!("ce" in segment)) starts.add(key);
    if (!("cs" in segment)) ends.add(key);
  }
  return new Set([...starts].filter((key) => ends.has(key)));
}

export interface V3cPackageOptions {
  /**
   * A file without commentsExtended, commentsIds, commentsExtensible or people: Word's package then
   * carries commentsIds, a commentsExtended without parents and people, but no commentsExtensible
   * (gate F2 on v3c-comments-legacy.docx). Its ids are the session's on desktop only; the web's
   * differ from Comment.id.
   */
  legacy?: boolean;
  /** The durableId (hex) per comment key a legacy file's package carries; the fixture's otherwise. */
  sessionIds?: (key: string) => string;
  /** No commentsExtended, commentsIds, commentsExtensible or people part, as Word never writes. */
  idless?: boolean;
  /**
   * Word's own re-serialisation of a reference-only comment: an empty range around it (the probe's
   * T5P marks were start, end and reference at 28).
   */
  collapsedPoints?: boolean;
  /** Keep marks of threads that run out of the package, as no measured host did. */
  openMarks?: boolean;
  /** Comments whose text Word writes as two paragraphs; the first gets a paraId commentsIds lacks. */
  twoParagraphs?: readonly string[];
}

interface Numbering {
  ids: Map<string, number>;
  next: number;
}

const localId = (numbering: Numbering, key: string) => {
  if (!numbering.ids.has(key)) numbering.ids.set(key, numbering.next++);
  return numbering.ids.get(key) as number;
};

function paragraphXml(
  tag: string,
  numbering: Numbering,
  keep: ReadonlySet<string>,
  options: V3cPackageOptions,
): string {
  const reference = (key: string) =>
    `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${localId(numbering, key)}"/></w:r>`;
  const xml = V3C_PARAGRAPHS[tag]
    .map((segment) => {
      if (typeof segment === "string") return run(segment);
      if ("hidden" in segment) return run(segment.hidden, "<w:vanish/>");
      if ("del" in segment)
        return `<w:del w:id="${numbering.next++}" w:author="Other Author" w:date="2026-09-08T12:00:00Z"><w:r><w:delText xml:space="preserve">${escapeXml(segment.del)}</w:delText></w:r></w:del>`;
      if ("pageBreak" in segment) return `<w:r><w:br w:type="page"/></w:r>`;
      const key = keyOf(segment) as string;
      if (!keep.has(key) && !options.openMarks) return "";
      const thread = threadOf(key);
      if ("cs" in segment)
        return thread
          .map((k) => `<w:commentRangeStart w:id="${localId(numbering, k)}"/>`)
          .join("");
      if ("ce" in segment)
        return thread
          .map(
            (k) =>
              `<w:commentRangeEnd w:id="${localId(numbering, k)}"/>${reference(k)}`,
          )
          .join("");
      return thread
        .map((k) =>
          options.collapsedPoints
            ? `<w:commentRangeStart w:id="${localId(numbering, k)}"/><w:commentRangeEnd w:id="${localId(numbering, k)}"/>${reference(k)}`
            : reference(k),
        )
        .join("");
    })
    .join("");
  return `<w:p>${xml}</w:p>`;
}

const part = (name: string, type: string, xml: string) =>
  `<pkg:part pkg:name="${name}" pkg:contentType="${type}"><pkg:xmlData>${xml}</pkg:xmlData></pkg:part>`;

const commentContent = (key: string) =>
  key === "T11"
    ? `${run("T11 root: see ")}${run("this point", "<w:b/><w:bCs/>")}${run(" and ")}<w:hyperlink r:id="rIdCmLink" w:history="1">${run("the spec", '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>${run(".")}`
    : run(V3C_COMMENTS[key].content);

function packageXml(
  body: string,
  numbering: Numbering,
  options: V3cPackageOptions,
): string {
  const keys = [...numbering.ids.keys()];
  const local = (key: string) => numbering.ids.get(key) as number;
  const annotation = `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>`;
  const commentXml = (key: string) => {
    const c = V3C_COMMENTS[key];
    const own = `<w:p w14:paraId="${c.paraId}" w14:textId="77777777"><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>${annotation}${commentContent(key)}</w:p>`;
    const paragraphs = options.twoParagraphs?.includes(key)
      ? `<w:p w14:paraId="0F0F0F0F" w14:textId="77777777"><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>${annotation}${run("First paragraph of the comment.")}</w:p>${own.replace(annotation, "")}`
      : own;
    return `<w:comment w:id="${local(key)}" w:author="${escapeXml(c.author)}" w:date="${c.date}" w:initials="${c.initials}">${paragraphs}</w:comment>`;
  };
  const parts = [
    part(
      "/word/document.xml",
      `${WML}.document.main+xml`,
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}" xmlns:r="${R}" xmlns:mc="${MC}" mc:Ignorable="w14"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,
    ),
  ];
  if (keys.length > 0) {
    parts.push(
      part(
        "/word/comments.xml",
        `${WML}.comments+xml`,
        `<w:comments xmlns:w="${W}" xmlns:w14="${W14}" xmlns:r="${R}" xmlns:mc="${MC}" mc:Ignorable="w14">${keys.map(commentXml).join("")}</w:comments>`,
      ),
    );
    const durableId = (key: string) =>
      (options.legacy && options.sessionIds?.(key)) ||
      V3C_COMMENTS[key].durableId;
    if (!options.idless)
      parts.push(
        part(
          "/word/commentsExtended.xml",
          `${WML}.commentsExtended+xml`,
          `<w15:commentsEx xmlns:mc="${MC}" xmlns:w15="${W15}" mc:Ignorable="w15">${keys
            .map((key) => {
              const c = V3C_COMMENTS[key];
              const parent =
                c.parent && !options.legacy
                  ? ` w15:paraIdParent="${V3C_COMMENTS[c.parent].paraId}"`
                  : "";
              return `<w15:commentEx w15:paraId="${c.paraId}"${parent} w15:done="${c.done ? 1 : 0}"/>`;
            })
            .join("")}</w15:commentsEx>`,
        ),
        part(
          "/word/commentsIds.xml",
          `${WML}.commentsIds+xml`,
          `<w16cid:commentsIds xmlns:mc="${MC}" xmlns:w16cid="${W16CID}" mc:Ignorable="w16cid">${keys
            .map(
              (key) =>
                `<w16cid:commentId w16cid:paraId="${V3C_COMMENTS[key].paraId}" w16cid:durableId="${durableId(key)}"/>`,
            )
            .join("")}</w16cid:commentsIds>`,
        ),
        ...(options.legacy
          ? []
          : [
              part(
                "/word/commentsExtensible.xml",
                `${WML}.commentsExtensible+xml`,
                `<w16cex:commentsExtensible xmlns:mc="${MC}" xmlns:w16cex="${W16CEX}" mc:Ignorable="w16cex">${keys
                  .filter((key) => V3C_COMMENTS[key].dateUtc)
                  .map(
                    (key) =>
                      `<w16cex:commentExtensible w16cex:durableId="${V3C_COMMENTS[key].durableId}" w16cex:dateUtc="${V3C_COMMENTS[key].dateUtc}"/>`,
                  )
                  .join("")}</w16cex:commentsExtensible>`,
              ),
            ]),
        part(
          "/word/people.xml",
          `${WML}.people+xml`,
          `<w15:people xmlns:mc="${MC}" xmlns:w15="${W15}" mc:Ignorable="w15">${[
            MK,
            JW,
            LF,
          ]
            .map(
              (p) =>
                `<w15:person w15:author="${escapeXml(p.author)}"><w15:presenceInfo w15:providerId="None" w15:userId="${escapeXml(p.author)}"/></w15:person>`,
            )
            .join("")}</w15:people>`,
        ),
      );
  }
  return `<?xml version="1.0" standalone="yes"?><?mso-application progid="Word.Document"?><pkg:package xmlns:pkg="${PKG}">${parts.join("")}</pkg:package>`;
}

const cell = (paragraph: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${paragraph}</w:tc>`;

const row = (cells: readonly string[]) =>
  `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${cells.map(() => '<w:gridCol w:w="4500"/>').join("")}</w:tblGrid><w:tr>${cells.map(cell).join("")}</w:tr></w:tbl>`;

/** Word's empty paragraph after a package's content. */
const TRAILING = '<w:p w14:paraId="7838ABCE"/>';

/** paragraph.getOoxml() of one paragraph: on every host for body text, on the web for a cell. */
export function v3cParagraphPackage(
  tag: string,
  options: V3cPackageOptions = {},
): string {
  const numbering: Numbering = { ids: new Map(), next: 0 };
  const xml = paragraphXml(tag, numbering, containedThreads([tag]), options);
  return packageXml(`${xml}${TRAILING}`, numbering, options);
}

/** Desktop's getOoxml() of a paragraph that ends a cell: the whole row, then an empty paragraph. */
export function v3cRowPackage(
  cellTags: readonly string[],
  options: V3cPackageOptions = {},
): string {
  const numbering: Numbering = { ids: new Map(), next: 0 };
  const keep = containedThreads(cellTags);
  const cells = cellTags.map((tag) =>
    paragraphXml(tag, numbering, keep, options),
  );
  return packageXml(`${row(cells)}${TRAILING}`, numbering, options);
}

/** getOoxml() of the range from a first to a last body paragraph (desktop). */
export function v3cRangePackage(
  tags: readonly string[],
  options: V3cPackageOptions = {},
): string {
  const numbering: Numbering = { ids: new Map(), next: 0 };
  const keep = containedThreads(tags);
  const paragraphs = tags.map((tag) =>
    paragraphXml(tag, numbering, keep, options),
  );
  return packageXml(`${paragraphs.join("")}${TRAILING}`, numbering, options);
}

/**
 * paragraph.text: tracked deletions on every host, hidden text on the web only, and on the web
 * one U+0005 per thread at its reference (T1P shows one for a root with two replies).
 */
export function v3cRangeText(tag: string, host: V3cHost): string {
  return V3C_PARAGRAPHS[tag]
    .map((segment) => {
      if (typeof segment === "string") return segment;
      if ("hidden" in segment) return host === "web" ? segment.hidden : "";
      if ("del" in segment) return segment.del;
      if ("ce" in segment || "point" in segment)
        return host === "web" ? "\u0005" : "";
      return "";
    })
    .join("");
}

/** getText() without hidden or deleted text: the ground truth's visible text. */
export function v3cVisibleText(tag: string): string {
  return V3C_PARAGRAPHS[tag]
    .filter((segment): segment is string => typeof segment === "string")
    .join("");
}
