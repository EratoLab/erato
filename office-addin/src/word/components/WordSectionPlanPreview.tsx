import { Card } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "../utils/wordDocumentPlan";
import type { WordSectionPlan, WordSectionStories } from "../utils/wordStories";

/** Word-specific page geometry; application controls continue to use the kit. */
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
      const page =
        variant === "first"
          ? t({
              id: "officeAddin.word.authoring.firstPage",
              message: "First page",
            })
          : variant === "even"
            ? t({
                id: "officeAddin.word.authoring.evenPages",
                message: "Even pages",
              })
            : t({
                id: "officeAddin.word.authoring.defaultPages",
                message: "Default pages",
              });
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
      <p>
        {layout.orientation === "landscape"
          ? t({
              id: "officeAddin.word.authoring.landscape",
              message: "Landscape",
            })
          : t({
              id: "officeAddin.word.authoring.portrait",
              message: "Portrait",
            })}
      </p>
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
            [
              t({
                id: "officeAddin.word.authoring.marginTop",
                message: "Top margin",
              }),
              margins.top,
            ],
            [
              t({
                id: "officeAddin.word.authoring.marginBottom",
                message: "Bottom margin",
              }),
              margins.bottom,
            ],
            [
              t({
                id: "officeAddin.word.authoring.marginLeft",
                message: "Left margin",
              }),
              margins.left,
            ],
            [
              t({
                id: "officeAddin.word.authoring.marginRight",
                message: "Right margin",
              }),
              margins.right,
            ],
            [
              t({
                id: "officeAddin.word.authoring.headerDistance",
                message: "Header from top",
              }),
              margins.header,
            ],
            [
              t({
                id: "officeAddin.word.authoring.footerDistance",
                message: "Footer from bottom",
              }),
              margins.footer,
            ],
            [
              t({ id: "officeAddin.word.authoring.gutter", message: "Gutter" }),
              margins.gutter,
            ],
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
      {layout.break && (
        <p>
          {layout.break === "continuous"
            ? t({
                id: "officeAddin.word.authoring.continuousSection",
                message: "Continue on the same page",
              })
            : layout.break === "evenPage"
              ? t({
                  id: "officeAddin.word.authoring.evenSection",
                  message: "Start on the next even page",
                })
              : layout.break === "oddPage"
                ? t({
                    id: "officeAddin.word.authoring.oddSection",
                    message: "Start on the next odd page",
                  })
                : t({
                    id: "officeAddin.word.authoring.nextPageSection",
                    message: "Start on the next page",
                  })}
        </p>
      )}
      {layout.differentFirstPage !== undefined && (
        <p>
          {layout.differentFirstPage
            ? t({
                id: "officeAddin.word.authoring.separateFirstPage",
                message: "Different first-page header and footer",
              })
            : t({
                id: "officeAddin.word.authoring.sameFirstPage",
                message: "Use regular header and footer on the first page",
              })}
        </p>
      )}
      {layout.differentOddEvenPages !== undefined && (
        <p>
          {layout.differentOddEvenPages
            ? t({
                id: "officeAddin.word.authoring.separateOddEvenPages",
                message: "Different headers and footers on odd and even pages",
              })
            : t({
                id: "officeAddin.word.authoring.sameOddEvenPages",
                message:
                  "Use the same headers and footers on odd and even pages",
              })}
        </p>
      )}
      {!!Object.keys(headers).length && (
        <>
          <strong>
            {t({ id: "officeAddin.word.authoring.header", message: "Header" })}
          </strong>
          <ul>{binding(headers)}</ul>
        </>
      )}
      {!!Object.keys(footers).length && (
        <>
          <strong>
            {t({ id: "officeAddin.word.authoring.footer", message: "Footer" })}
          </strong>
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
