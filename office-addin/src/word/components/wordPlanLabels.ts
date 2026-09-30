import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";

import {
  pointsToCentimeters,
  pointsToMillimeters,
  wordLength,
} from "../utils/wordPlanReview";

import type {
  WordLayoutProperty,
  WordLayoutValue,
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

export function formatList(parts: string[]): string {
  return new Intl.ListFormat(locale(), {
    style: "short",
    type: "unit",
  }).format(parts);
}
