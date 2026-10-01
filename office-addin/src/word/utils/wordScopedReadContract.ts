import {
  WORD_AUTHORING_CONTRACT as full,
  WORD_SECTION_PROPERTIES,
} from "./wordAuthoringContract";
import { wordImageAssetMetadata } from "./wordImageAssetData";

import type { WordAuthoringSnapshot } from "./wordDocumentPlan";
import type { WordScopeTarget } from "./wordReadScope";

export const WORD_SCOPED_GUIDANCE = [
  "text",
  "formatting",
  "table",
  "media",
  "structures",
  "stories",
  "sections",
] as const;
export type WordScopedGuidance = (typeof WORD_SCOPED_GUIDANCE)[number];

/** Guidance is presentation, never authorization. Explicit includes support new
 * structures even when the selected source has a different kind. */
export function wordScopedReadContract(
  snapshot: WordAuthoringSnapshot,
  targets: WordScopeTarget[],
  include: WordScopedGuidance[] = [],
) {
  const groups = new Set<WordScopedGuidance>(include);
  const styles = new Set<string>();
  const kind = (value: unknown) => {
    if (["paragraph", "heading", "list-item"].includes(String(value)))
      groups.add("text");
    if (value === "table") groups.add("table");
    if (["image", "drawing"].includes(String(value))) groups.add("media");
    if (["field", "bookmark", "content-control"].includes(String(value)))
      groups.add("structures");
    if (
      ["header", "footer", "footnote", "endnote", "comment"].includes(
        String(value),
      )
    )
      groups.add("stories");
    if (value === "section") groups.add("sections");
  };
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(visit);
    const record = value as Record<string, unknown>;
    kind(record.type);
    kind(record.kind);
    kind(record.nativeKind);
    if (typeof record.styleRef === "string") styles.add(record.styleRef);
    Object.values(record).forEach(visit);
  };
  targets.forEach((target) => {
    kind(target.kind);
    visit(target.detail);
  });
  // Nested content and replacements use the same typed paragraph vocabulary.
  if (
    targets.some((t) => t.bodyRef) ||
    groups.has("table") ||
    groups.has("structures") ||
    groups.has("stories")
  )
    groups.add("text");
  const body = targets.some((t) => t.bodyRef && !t.objectTarget);
  const objects = targets.some((t) => t.objectTarget);
  return {
    contract: {
      version: full.version,
      availableGuidance: WORD_SCOPED_GUIDANCE,
      include:
        "Optional include:[groups] on a target read adds guidance for intended new content or formatting, regardless of source kind. Re-read the same refs with include if needed; it does not expand authorization. formatting returns available styles; media returns attachment metadata. Full reads return the complete contract.",
      scopedEdit: {
        input: full.scopedEdit.input,
        authorization: full.scopedEdit.authorization,
        ...(body ? { body: full.scopedEdit.body } : {}),
        ...(objects ? { objects: full.scopedEdit.objects } : {}),
        ...(groups.has("stories") ? { stories: full.scopedEdit.stories } : {}),
        ...(groups.has("sections")
          ? { sections: full.scopedEdit.sections }
          : {}),
      },
      ...(groups.has("text")
        ? {
            formattingContext:
              "Target content already includes its supported captured formatting; omitted typed formatting fields do not mean an incomplete read. Reuse the supplied formatting and list identity without a style-catalogue lookup for simple retention or list continuation. Paragraph, heading and list-item blocks do not accept sourceRef; ownership is supplied by the body operation's source/anchor.",
            paragraphs: full.paragraphs,
            runFormatting: full.runFormatting,
            paragraphFormatting: full.paragraphFormatting,
          }
        : {}),
      ...(groups.has("formatting") || groups.has("table")
        ? { borders: full.borders }
        : {}),
      ...(groups.has("table") ? { table: full.table } : {}),
      ...(groups.has("media") ? { media: full.media } : {}),
      ...(groups.has("structures") || objects
        ? { structures: full.structures }
        : {}),
      ...(groups.has("stories") ? { stories: full.stories } : {}),
      // The scoped section vocabulary differs from the full-plan section list.
      ...(groups.has("sections")
        ? { sectionLayout: WORD_SECTION_PROPERTIES }
        : {}),
    },
    styles: snapshot.styles.filter(
      (style) => groups.has("formatting") || styles.has(style.id),
    ),
    ...(groups.has("media")
      ? {
          assets: (snapshot.assets ?? []).map(wordImageAssetMetadata),
          imageAssetIssues: (snapshot.imageAssetIssues ?? []).map(
            ({ name, reason }) => ({ name, reason }),
          ),
        }
      : {}),
  };
}
