import { Card } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

import {
  bindingLabel,
  firstPageLabel,
  marginLabels,
  oddEvenPagesLabel,
  orientationLabel,
  sectionBreakLabel,
  storyLabel,
} from "./wordPlanLabels";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "../utils/wordDocumentPlan";
import type { WordSectionPlan, WordSectionStories } from "../utils/wordStories";

export function WordSectionPlanPreview({
  section,
  index,
  snapshot,
  plan,
  label,
}: {
  section: WordSectionPlan;
  index: number;
  snapshot: WordAuthoringSnapshot;
  plan: WordDocumentPlan;
  label: (ref: string) => string;
}) {
  const source =
    snapshot.sections?.find((s) => s.id === section.source) ??
    snapshot.sections?.at(-1);
  const layout = { ...source?.layout, ...section.layout };
  if (
    section.layout?.orientation &&
    section.layout.width === undefined &&
    section.layout.height === undefined &&
    layout.width !== undefined &&
    layout.height !== undefined &&
    (layout.orientation === "landscape") !== layout.width > layout.height
  )
    [layout.width, layout.height] = [layout.height, layout.width];
  const margins = { ...source?.layout.margins, ...section.layout?.margins };
  const labels = marginLabels();
  const headers = { ...source?.headers, ...section.headers };
  const footers = { ...source?.footers, ...section.footers };
  const binding = (value: WordSectionStories | undefined) =>
    Object.entries(value ?? {}).map(([variant, ref]) => {
      const changed = plan.stories?.find((s) => s.id === ref);
      const story = snapshot.stories?.find((s) => s.id === ref);
      const empty = t({
        id: "officeAddin.word.authoring.emptyPart",
        message: "Empty",
      });
      const native = t({
        id: "officeAddin.word.authoring.nativeObject",
        message: "Native document content",
      });
      const text =
        changed?.kind === "delete" || ref === null
          ? empty
          : changed?.kind === "upsert"
            ? changed.blocks
                ?.map((b) => b.text)
                .filter(Boolean)
                .join(" · ") || (changed.blocks?.length ? native : empty)
            : story?.text || native;
      const page = bindingLabel(variant as keyof WordSectionStories);
      return (
        <li key={variant}>
          {page}: {text.slice(0, 180)}
        </li>
      );
    });
  return (
    <Card variant="surface" size="sm">
      <strong>
        {t({
          id: "officeAddin.word.authoring.sectionNumber",
          message: `Section ${index + 1}`,
        })}
      </strong>
      <p>{orientationLabel(layout.orientation)}</p>
      {layout.width !== undefined && layout.height !== undefined && (
        <p>
          {t({
            id: "officeAddin.word.authoring.pageDimensions",
            message: `Page size: ${layout.width} × ${layout.height} pt`,
          })}
        </p>
      )}
      <p>
        {t({
          id: "officeAddin.word.authoring.columnCount",
          message: `${layout.columns ?? 1} columns`,
        })}
        {layout.columnSpacing !== undefined && (
          <>
            {" "}
            ·{" "}
            {t({
              id: "officeAddin.word.authoring.columnSpacing",
              message: `${layout.columnSpacing} pt apart`,
            })}
          </>
        )}
      </p>
      <dl>
        {(
          [
            [labels.top, margins.top],
            [labels.bottom, margins.bottom],
            [labels.left, margins.left],
            [labels.right, margins.right],
            [labels.header, margins.header],
            [labels.footer, margins.footer],
            [labels.gutter, margins.gutter],
          ] as const
        )
          .filter(([, value]) => value !== undefined)
          .map(([name, value]) => (
            <div key={name} className="flex flex-wrap justify-between gap-2">
              <dt>{name}</dt>
              <dd>{value} pt</dd>
            </div>
          ))}
      </dl>
      {layout.pageNumberStart !== undefined && (
        <p>
          {t({
            id: "officeAddin.word.authoring.pageNumberStart",
            message: `Page numbering starts at ${layout.pageNumberStart}`,
          })}
        </p>
      )}
      {layout.break && <p>{sectionBreakLabel(layout.break)}</p>}
      {layout.differentFirstPage !== undefined && (
        <p>{firstPageLabel(layout.differentFirstPage)}</p>
      )}
      {layout.differentOddEvenPages !== undefined && (
        <p>{oddEvenPagesLabel(layout.differentOddEvenPages)}</p>
      )}
      {!!Object.keys(headers).length && (
        <>
          <strong>{storyLabel("header")}</strong>
          <ul>{binding(headers)}</ul>
        </>
      )}
      {!!Object.keys(footers).length && (
        <>
          <strong>{storyLabel("footer")}</strong>
          <ul>{binding(footers)}</ul>
        </>
      )}
      <p className="word-review__hint">
        {section.after
          ? t({
              id: "officeAddin.word.authoring.sectionAfter",
              message: `Ends after ${label(section.after)}`,
            })
          : t({
              id: "officeAddin.word.authoring.finalSection",
              message: "Final section",
            })}
      </p>
    </Card>
  );
}
