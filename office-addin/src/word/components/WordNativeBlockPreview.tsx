import { Card } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

import type { WordSourceBlock } from "../utils/wordDocumentPlan";
import type { WordPlanObjectKind } from "../utils/wordPlanReview";

export function WordNativeBlockPreview({ block }: { block: WordSourceBlock }) {
  return (
    <Card variant="surface" size="sm">
      <strong>{nativeKindLabel(block.nativeKind)}</strong>
      {block.description && (
        <p className="word-review__text">{block.description}</p>
      )}
      {block.text && <p className="word-review__text">{block.text}</p>}
    </Card>
  );
}
export function nativeKindLabel(
  kind: WordSourceBlock["nativeKind"] | WordPlanObjectKind,
): string {
  switch (kind) {
    case "drawing":
      return t({ id: "officeAddin.word.rich.drawing", message: "Drawing" });
    case "bookmark":
      return t({ id: "officeAddin.word.rich.bookmark", message: "Bookmark" });
    case "table":
      return t({
        id: "officeAddin.word.authoring.nativeTable",
        message: "Table",
      });
    case "image":
      return t({
        id: "officeAddin.word.authoring.nativeImage",
        message: "Image or drawing",
      });
    case "field":
      return t({
        id: "officeAddin.word.authoring.nativeField",
        message: "Document field",
      });
    case "content-control":
      return t({
        id: "officeAddin.word.authoring.nativeControl",
        message: "Content control",
      });
    case "anchored-content":
      return t({
        id: "officeAddin.word.authoring.nativeAnchored",
        message: "Content with linked annotations",
      });
    case "section-break":
      return t({
        id: "officeAddin.word.authoring.nativeSection",
        message: "Section boundary",
      });
    default:
      return t({
        id: "officeAddin.word.authoring.nativeObject",
        message: "Native document content",
      });
  }
}
