import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";

import {
  pointsToCentimeters,
  pointsToMillimeters,
  wordLength,
} from "../utils/wordPlanReview";

import type { WordDocumentPlan } from "../utils/wordDocumentPlan";
import type {
  WordLayoutProperty,
  WordLayoutValue,
  WordPlanGroupSummary,
  WordPlanReview,
  WordPlanReviewSize,
  WordPlanScopePart,
  WordPlanTitle,
} from "../utils/wordPlanReview";
import type {
  WordPageLayout,
  WordSectionStories,
  WordStoryType,
} from "../utils/wordStories";

const locale = () => i18n.locale || undefined;

export function storyLabel(type: WordStoryType): string {
  switch (type) {
    case "header":
      return t({ id: "officeAddin.word.authoring.header", message: "Header" });
    case "footer":
      return t({ id: "officeAddin.word.authoring.footer", message: "Footer" });
    case "footnote":
      return t({
        id: "officeAddin.word.authoring.footnote",
        message: "Footnote",
      });
    case "endnote":
      return t({
        id: "officeAddin.word.authoring.endnote",
        message: "Endnote",
      });
    default:
      return t({
        id: "officeAddin.word.authoring.comment",
        message: "Comment",
      });
  }
}

export function bindingLabel(variant: keyof WordSectionStories): string {
  return variant === "first"
    ? t({ id: "officeAddin.word.authoring.firstPage", message: "First page" })
    : variant === "even"
      ? t({ id: "officeAddin.word.authoring.evenPages", message: "Even pages" })
      : t({
          id: "officeAddin.word.authoring.defaultPages",
          message: "Default pages",
        });
}

export function orientationLabel(value: WordPageLayout["orientation"]): string {
  return value === "landscape"
    ? t({ id: "officeAddin.word.authoring.landscape", message: "Landscape" })
    : t({ id: "officeAddin.word.authoring.portrait", message: "Portrait" });
}

export function sectionBreakLabel(value: WordPageLayout["break"]): string {
  return value === "continuous"
    ? t({
        id: "officeAddin.word.authoring.continuousSection",
        message: "Continue on the same page",
      })
    : value === "evenPage"
      ? t({
          id: "officeAddin.word.authoring.evenSection",
          message: "Start on the next even page",
        })
      : value === "oddPage"
        ? t({
            id: "officeAddin.word.authoring.oddSection",
            message: "Start on the next odd page",
          })
        : t({
            id: "officeAddin.word.authoring.nextPageSection",
            message: "Start on the next page",
          });
}

export function firstPageLabel(different: boolean): string {
  return different
    ? t({
        id: "officeAddin.word.authoring.separateFirstPage",
        message: "Different first-page header and footer",
      })
    : t({
        id: "officeAddin.word.authoring.sameFirstPage",
        message: "Use regular header and footer on the first page",
      });
}

export function oddEvenPagesLabel(different: boolean): string {
  return different
    ? t({
        id: "officeAddin.word.authoring.separateOddEvenPages",
        message: "Different headers and footers on odd and even pages",
      })
    : t({
        id: "officeAddin.word.authoring.sameOddEvenPages",
        message: "Use the same headers and footers on odd and even pages",
      });
}

export const marginLabels = () => ({
  top: t({ id: "officeAddin.word.authoring.marginTop", message: "Top margin" }),
  bottom: t({
    id: "officeAddin.word.authoring.marginBottom",
    message: "Bottom margin",
  }),
  left: t({
    id: "officeAddin.word.authoring.marginLeft",
    message: "Left margin",
  }),
  right: t({
    id: "officeAddin.word.authoring.marginRight",
    message: "Right margin",
  }),
  header: t({
    id: "officeAddin.word.authoring.headerDistance",
    message: "Header from top",
  }),
  footer: t({
    id: "officeAddin.word.authoring.footerDistance",
    message: "Footer from bottom",
  }),
  gutter: t({ id: "officeAddin.word.authoring.gutter", message: "Gutter" }),
});

export function layoutPropertyLabel(property: WordLayoutProperty): string {
  const margins = marginLabels();
  switch (property) {
    case "orientation":
      return t({
        id: "officeAddin.word.layout.orientation",
        message: "Orientation",
      });
    case "width":
      return t({ id: "officeAddin.word.layout.width", message: "Page width" });
    case "height":
      return t({
        id: "officeAddin.word.layout.height",
        message: "Page height",
      });
    case "marginTop":
      return margins.top;
    case "marginRight":
      return margins.right;
    case "marginBottom":
      return margins.bottom;
    case "marginLeft":
      return margins.left;
    case "marginHeader":
      return margins.header;
    case "marginFooter":
      return margins.footer;
    case "marginGutter":
      return margins.gutter;
    case "columns":
      return t({ id: "officeAddin.word.layout.columns", message: "Columns" });
    case "columnSpacing":
      return t({
        id: "officeAddin.word.layout.columnSpacing",
        message: "Column spacing",
      });
    case "break":
      return t({
        id: "officeAddin.word.layout.break",
        message: "Section start",
      });
    case "pageNumberStart":
      return t({
        id: "officeAddin.word.layout.pageNumberStart",
        message: "First page number",
      });
    case "differentFirstPage":
      return bindingLabel("first");
    case "differentOddEvenPages":
      return t({
        id: "officeAddin.word.layout.oddEvenPages",
        message: "Odd and even pages",
      });
  }
}

/** One unit per group of lengths, so "9 mm → 1.2 cm" never mixes units. */
export function formatWordLengths(points: number[]): string[] {
  const unit = wordLength(Math.max(0, ...points.map(Math.abs))).unit;
  const format = new Intl.NumberFormat(locale(), {
    style: "unit",
    unit: unit === "cm" ? "centimeter" : "millimeter",
    unitDisplay: "short",
    maximumFractionDigits: unit === "cm" ? 2 : 1,
  });
  return points.map((pt) =>
    format.format(
      unit === "cm" ? pointsToCentimeters(pt) : pointsToMillimeters(pt),
    ),
  );
}

export function formatCentimeters(pt: number): string {
  return new Intl.NumberFormat(locale(), {
    maximumFractionDigits: 2,
  }).format(pointsToCentimeters(pt));
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat(locale()).format(value);
}

/** Lengths are formatted by the caller so a before/after pair shares one unit. */
export function layoutValueLabel(
  property: WordLayoutProperty,
  value: WordLayoutValue,
): string {
  switch (property) {
    case "orientation":
      return orientationLabel(value as WordPageLayout["orientation"]);
    case "break":
      return sectionBreakLabel(value as WordPageLayout["break"]);
    case "differentFirstPage":
      return firstPageLabel(value === true);
    case "differentOddEvenPages":
      return oddEvenPagesLabel(value === true);
    default:
      return typeof value === "number" ? formatCount(value) : String(value);
  }
}

export function formatList(
  parts: string[],
  type: "unit" | "conjunction" = "unit",
): string {
  return new Intl.ListFormat(locale(), {
    style: type === "unit" ? "short" : "long",
    type,
  }).format(parts);
}

export function emptyPartLabel(): string {
  return t({ id: "officeAddin.word.authoring.emptyPart", message: "Empty" });
}

/** Noun phrases that complete "… sections and {parts}" in the plan title. */
function storyNoun(type: WordStoryType): string {
  switch (type) {
    case "header":
      return t({
        id: "officeAddin.word.planTitle.header",
        message: "the header",
      });
    case "footer":
      return t({
        id: "officeAddin.word.planTitle.footer",
        message: "the footer",
      });
    case "footnote":
      return t({
        id: "officeAddin.word.planTitle.footnotes",
        message: "footnotes",
      });
    case "endnote":
      return t({
        id: "officeAddin.word.planTitle.endnotes",
        message: "endnotes",
      });
    default:
      return t({
        id: "officeAddin.word.planTitle.comments",
        message: "comments",
      });
  }
}
const layoutNoun = () =>
  t({ id: "officeAddin.word.planTitle.layout", message: "page layout" });

function extras(parts: WordStoryType[], layout: boolean): string {
  return formatList(
    [...new Set(parts.map(storyNoun)), ...(layout ? [layoutNoun()] : [])],
    "conjunction",
  );
}

export function wordPlanTitleText(title: WordPlanTitle): string {
  switch (title.kind) {
    case "cells":
      return t({
        id: "officeAddin.word.planTitle.cells",
        message: plural(title.n, {
          one: "Change # table cell",
          other: "Change # table cells",
        }),
      });
    case "paragraphs-added":
      return t({
        id: "officeAddin.word.planTitle.paragraphsAdded",
        message: plural(title.n, {
          one: "Add # paragraph",
          other: "Add # paragraphs",
        }),
      });
    case "blocks-added":
      return t({
        id: "officeAddin.word.planTitle.blocksAdded",
        message: plural(title.n, {
          one: "Add # item",
          other: "Add # items",
        }),
      });
    case "paragraphs-changed":
      return t({
        id: "officeAddin.word.planTitle.paragraphsChanged",
        message: plural(title.n, {
          one: "Change # paragraph",
          other: "Change # paragraphs",
        }),
      });
    case "removed":
      return t({
        id: "officeAddin.word.planTitle.removed",
        message: plural(title.n, {
          one: "Remove # item",
          other: "Remove # items",
        }),
      });
    case "none":
      return t({
        id: "officeAddin.word.planTitle.none",
        message: "Nothing to change",
      });
    case "sections": {
      const { changed, total, added } = title;
      const also = extras(title.parts, title.layout);
      if (added)
        return also
          ? t({
              id: "officeAddin.word.planTitle.sectionsAddedAnd",
              message: plural(added, {
                one: `Update ${changed} of ${total} sections and ${also}, and add # section`,
                other: `Update ${changed} of ${total} sections and ${also}, and add # sections`,
              }),
            })
          : t({
              id: "officeAddin.word.planTitle.sectionsAdded",
              message: plural(added, {
                one: `Update ${changed} of ${total} sections and add # section`,
                other: `Update ${changed} of ${total} sections and add # sections`,
              }),
            });
      return also
        ? t({
            id: "officeAddin.word.planTitle.sectionsAnd",
            message: `Update ${changed} of ${total} sections and ${also}`,
          })
        : t({
            id: "officeAddin.word.planTitle.sections",
            message: `Update ${changed} of ${total} sections`,
          });
    }
    case "layout": {
      const also = extras(title.parts, title.sections > 0);
      return t({
        id: "officeAddin.word.planTitle.layoutOnly",
        message: `Update ${also}`,
      });
    }
    case "summary":
      return t({
        id: "officeAddin.word.planTitle.summary",
        message: "Rewrite as a new version",
      });
    case "blocks-changed": {
      const n = title.n;
      const also = extras(title.parts, title.layout);
      return also
        ? t({
            id: "officeAddin.word.planTitle.blocksChangedAnd",
            message: plural(n, {
              one: `Change # item and ${also}`,
              other: `Change # items and ${also}`,
            }),
          })
        : t({
            id: "officeAddin.word.planTitle.blocksChanged",
            message: plural(n, {
              one: "Change # item",
              other: "Change # items",
            }),
          });
    }
  }
}

export function wordPlanChip(review: WordPlanReview): {
  label: string;
  toneClassName?: string;
} {
  switch (review.variant) {
    case "addition":
      return {
        label: t({
          id: "officeAddin.word.planSize.addition",
          message: "Addition",
        }),
        toneClassName: "bg-theme-success-bg text-theme-success-fg",
      };
    case "layout":
      return {
        label: t({ id: "officeAddin.word.planSize.layout", message: "Layout" }),
      };
    case "restructured":
      return {
        label: t({
          id: "officeAddin.word.planSize.restructured",
          message: "Restructured",
        }),
        toneClassName: "bg-theme-warning-bg text-theme-warning-fg",
      };
  }
  return wordSizeChip(review.size);
}

export function wordSizeChip(size: WordPlanReviewSize): {
  label: string;
  toneClassName?: string;
} {
  return size === "large"
    ? {
        label: t({ id: "officeAddin.word.planSize.large", message: "Large" }),
        toneClassName: "bg-theme-warning-bg text-theme-warning-fg",
      }
    : size === "medium"
      ? {
          label: t({
            id: "officeAddin.word.planSize.medium",
            message: "Medium",
          }),
        }
      : {
          label: t({ id: "officeAddin.word.planSize.small", message: "Small" }),
          toneClassName: "bg-theme-bg-secondary text-theme-fg-secondary",
        };
}

function scopePartNoun(part: WordPlanScopePart): string {
  switch (part) {
    case "headers":
      return t({
        id: "officeAddin.word.planScope.headers",
        message: "headers",
      });
    case "footers":
      return t({
        id: "officeAddin.word.planScope.footers",
        message: "footers",
      });
    case "notes":
      return t({ id: "officeAddin.word.planScope.notes", message: "notes" });
    case "comments":
      return t({
        id: "officeAddin.word.planScope.comments",
        message: "comments",
      });
    case "layout":
      return t({
        id: "officeAddin.word.planScope.layout",
        message: "page layout",
      });
  }
}

/** The one place the card states what the plan leaves alone. */
export function wordPlanScopeText(
  review: WordPlanReview,
  plan: WordDocumentPlan,
): string {
  const sentences: string[] = [];
  if (plan.entries.length === 0)
    sentences.push(
      t({
        id: "officeAddin.word.authoring.clearBody",
        message:
          "The body will be cleared, leaving Word’s empty final paragraph.",
      }),
    );
  if (review.scope.unchanged.length) {
    // Only "page layout" is a singular noun; every other part is plural.
    const unchanged = review.scope.unchanged;
    const count = unchanged.length === 1 && unchanged[0] === "layout" ? 1 : 2;
    const list = formatList(unchanged.map(scopePartNoun), "conjunction");
    const sentence = t({
      id: "officeAddin.word.planScope.unchanged",
      message: plural(count, {
        one: `${list} stays as it is.`,
        other: `${list} stay as they are.`,
      }),
    });
    sentences.push(
      sentence.charAt(0).toLocaleUpperCase(locale()) + sentence.slice(1),
    );
  }
  if (review.scope.wholeFile)
    sentences.push(
      t({
        id: "officeAddin.word.planScope.wholeFile",
        message: "Word reloads the whole document file to apply this.",
      }),
    );
  return sentences.join(" ");
}

/** "Replace document" is kept for large whole-file rewrites; smaller plans name the change. */
export function wordPlanApplyLabel(review: WordPlanReview): string {
  if (review.scope.wholeFile && review.size === "large")
    return t({
      id: "officeAddin.word.planAction.replace",
      message: "Replace document",
    });
  if (review.title.kind === "paragraphs-added")
    return t({
      id: "officeAddin.word.planAction.insert",
      message: "Insert paragraphs",
    });
  const changes =
    review.rows.filter((r) => r.family !== "unchanged").length +
    review.partsRows.length;
  const single =
    review.title.kind === "cells" ? review.title.n === 1 : changes === 1;
  return single
    ? t({ id: "officeAddin.word.planAction.one", message: "Apply change" })
    : t({ id: "officeAddin.word.planAction.many", message: "Apply changes" });
}

export function wordPlanGroupSummaryText(
  summary: WordPlanGroupSummary,
): string {
  const parts: string[] = [];
  if (summary.tables) {
    const table = t({
      id: "officeAddin.word.planRow.tableCount",
      message: plural(summary.tables, { one: "# table", other: "# tables" }),
    });
    const cells = summary.cells;
    const details = [
      cells &&
        t({
          id: "officeAddin.word.planRow.cellsChanged",
          message: plural(cells, {
            one: "# cell changed",
            other: "# cells changed",
          }),
        }),
      summary.rowsAdded &&
        t({
          id: "officeAddin.word.planRow.rowsAdded",
          message: plural(summary.rowsAdded, {
            one: "# row added",
            other: "# rows added",
          }),
        }),
      summary.rowsRemoved &&
        t({
          id: "officeAddin.word.planRow.rowsRemoved",
          message: plural(summary.rowsRemoved, {
            one: "# row removed",
            other: "# rows removed",
          }),
        }),
    ].filter((part): part is string => !!part);
    parts.push(details.length ? `${table} (${formatList(details)})` : table);
  }
  if (summary.text)
    parts.push(
      t({
        id: "officeAddin.word.planRow.paragraphCount",
        message: plural(summary.text, {
          one: "# paragraph",
          other: "# paragraphs",
        }),
      }),
    );
  if (summary.objects)
    parts.push(
      t({
        id: "officeAddin.word.planRow.objectCount",
        message: plural(summary.objects, {
          one: "# other item",
          other: "# other items",
        }),
      }),
    );
  if (summary.removed)
    parts.push(
      t({
        id: "officeAddin.word.planGroup.removedCount",
        message: plural(summary.removed, {
          one: "# removed",
          other: "# removed",
        }),
      }),
    );
  return parts.join(" · ");
}
