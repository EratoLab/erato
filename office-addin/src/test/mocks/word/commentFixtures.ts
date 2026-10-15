import { escapeXml } from "../../../utils/escapeXml";

/**
 * Packages with comment threads as Word writes them: comments.xml plus the modern parts
 * (commentsExtended, commentsIds, commentsExtensible, people), and marks for a root and its replies
 * at the same place in the body.
 */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
const W16CID = "http://schemas.microsoft.com/office/word/2016/wordml/cid";
const W16CEX = "http://schemas.microsoft.com/office/word/2018/wordml/cex";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const MS_REL = "http://schemas.microsoft.com/office/2011/relationships";

export interface FixtureComment {
  /** w:id */
  id: string;
  author: string;
  initials?: string;
  date?: string;
  dateUtc?: string;
  text: string;
  /** The w14:paraId of the comment's paragraph, 8 hex digits. */
  paraId: string;
  /** Hex durableId; String(parseInt(durableId, 16)) is Comment.id. */
  durableId: string;
  /** The root's w:id, for a reply. */
  parent?: string;
  done?: boolean;
}

/** Start marks for every id, the anchored run, then an end mark and reference run per id. */
export function commentMarks(ids: readonly string[], anchored: string): string {
  return (
    ids.map((id) => `<w:commentRangeStart w:id="${id}"/>`).join("") +
    `<w:r><w:t xml:space="preserve">${escapeXml(anchored)}</w:t></w:r>` +
    ids
      .map(
        (id) =>
          `<w:commentRangeEnd w:id="${id}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r>`,
      )
      .join("")
  );
}

const run = (text: string) =>
  text ? `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>` : "";

export function commentedParagraph(
  before: string,
  anchored: string,
  after: string,
  ids: readonly string[],
): string {
  return `<w:p>${run(before)}${commentMarks(ids, anchored)}${run(after)}</w:p>`;
}

/** The start of a comment that spans paragraphs; `commentEnd` closes it. */
export const commentStart = (before: string, anchored: string, id: string) =>
  `<w:p>${run(before)}<w:commentRangeStart w:id="${id}"/>${run(anchored)}</w:p>`;
export const commentEnd = (anchored: string, after: string, id: string) =>
  `<w:p>${run(anchored)}<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>${run(after)}</w:p>`;

const part = (name: string, type: string, xml: string) =>
  `<pkg:part pkg:name="${name}" pkg:contentType="${type}"><pkg:xmlData>${xml}</pkg:xmlData></pkg:part>`;

/**
 * Adds the comment parts and their relationships to a package from packageXml(). `legacy` leaves
 * out every modern part, as files written before Word 2013 have no threads or durableIds.
 */
export function withComments(
  packageXml: string,
  comments: readonly FixtureComment[],
  options: { legacy?: boolean } = {},
): string {
  const authors = [...new Set(comments.map((c) => c.author))];
  const parts = [
    part(
      "/word/comments.xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml",
      `<w:comments xmlns:w="${W}" xmlns:w14="${W14}">${comments
        .map(
          (c) =>
            `<w:comment w:id="${c.id}" w:author="${escapeXml(c.author)}"${
              c.date ? ` w:date="${c.date}"` : ""
            }${c.initials ? ` w:initials="${escapeXml(c.initials)}"` : ""}><w:p w14:paraId="${c.paraId}" w14:textId="77777777"><w:r><w:annotationRef/></w:r><w:r><w:t xml:space="preserve">${escapeXml(c.text)}</w:t></w:r></w:p></w:comment>`,
        )
        .join("")}</w:comments>`,
    ),
  ];
  const rels = [
    ["comments", `${OFFICE_REL}/comments`, "comments.xml"],
  ] as string[][];
  if (!options.legacy) {
    const paraOf = new Map(comments.map((c) => [c.id, c.paraId]));
    parts.push(
      part(
        "/word/commentsExtended.xml",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml",
        `<w15:commentsEx xmlns:w15="${W15}">${comments
          .map(
            (c) =>
              `<w15:commentEx w15:paraId="${c.paraId}"${
                c.parent ? ` w15:paraIdParent="${paraOf.get(c.parent)}"` : ""
              } w15:done="${c.done ? 1 : 0}"/>`,
          )
          .join("")}</w15:commentsEx>`,
      ),
      part(
        "/word/commentsIds.xml",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml",
        `<w16cid:commentsIds xmlns:w16cid="${W16CID}">${comments
          .map(
            (c) =>
              `<w16cid:commentId w16cid:paraId="${c.paraId}" w16cid:durableId="${c.durableId}"/>`,
          )
          .join("")}</w16cid:commentsIds>`,
      ),
      part(
        "/word/commentsExtensible.xml",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtensible+xml",
        `<w16cex:commentsExtensible xmlns:w16cex="${W16CEX}">${comments
          .map(
            (c) =>
              `<w16cex:commentExtensible w16cex:durableId="${c.durableId}"${
                c.dateUtc ? ` w16cex:dateUtc="${c.dateUtc}"` : ""
              }/>`,
          )
          .join("")}</w16cex:commentsExtensible>`,
      ),
      part(
        "/word/people.xml",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml",
        `<w15:people xmlns:w15="${W15}">${authors
          .map(
            (author) =>
              `<w15:person w15:author="${escapeXml(author)}"><w15:presenceInfo w15:providerId="None" w15:userId="${escapeXml(author)}"/></w15:person>`,
          )
          .join("")}</w15:people>`,
      ),
    );
    rels.push(
      [
        "commentsExtended",
        `${MS_REL}/commentsExtended`,
        "commentsExtended.xml",
      ],
      [
        "commentsIds",
        `http://schemas.microsoft.com/office/2016/09/relationships/commentsIds`,
        "commentsIds.xml",
      ],
      [
        "commentsExtensible",
        `http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible`,
        "commentsExtensible.xml",
      ],
      ["people", `${MS_REL}/people`, "people.xml"],
    );
  }
  parts.push(
    part(
      "/word/_rels/document.xml.rels",
      "application/vnd.openxmlformats-package.relationships+xml",
      `<Relationships xmlns="${REL}">${rels
        .map(
          ([id, type, target]) =>
            `<Relationship Id="rId${id}" Type="${type}" Target="${target}"/>`,
        )
        .join("")}</Relationships>`,
    ),
  );
  return packageXml.replace(
    "</pkg:package>",
    `${parts.join("")}</pkg:package>`,
  );
}
