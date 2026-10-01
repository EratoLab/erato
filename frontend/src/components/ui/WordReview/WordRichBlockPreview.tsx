import { t } from "@lingui/core/macro";
import { useMemo } from "react";

import { Card } from "@/components/ui/Container/Card";
import {
  inventoryWordMedia,
  isWordImageSpec,
  readWordImageData,
  wordImageDimensions,
} from "@/lib/wordReview/wordMediaContent";
import {
  createWordListNumbering,
  wordSourceTable,
} from "@/lib/wordReview/wordPlanReview";
import {
  resolveWordSource,
  wordSourceDetails,
} from "@/lib/wordReview/wordRichContent";

import { nativeKindLabel } from "./WordNativeBlockPreview";
import { formatCentimeters } from "./wordPlanLabels";

import type {
  WordBorder,
  WordParagraphFormatting,
  WordRunFormatting,
} from "@/lib/wordReview/wordBlockFormatting";
import type {
  WordAuthoringSnapshot,
  WordPlanBlock,
} from "@/lib/wordReview/wordDocumentPlan";
import type { WordNativeStructureEdit } from "@/lib/wordReview/wordInlineStructures";
import type {
  WordDrawingSpec,
  WordImageSpec,
} from "@/lib/wordReview/wordMediaContent";
import type {
  WordTableBlock,
  WordTableCellFormatting,
} from "@/lib/wordReview/wordTableContent";
import type { CSSProperties } from "react";

import "./wordRichPreview.css";

const emptyCellLabel = () =>
  t({ id: "officeAddin.word.rich.emptyCell", message: "Empty cell" });
const imageLabel = () =>
  t({ id: "officeAddin.word.rich.image", message: "Image" });

type PreviewProps = {
  block: WordPlanBlock;
  snapshot: WordAuthoringSnapshot;
  maxTableRows?: number;
};
/* eslint-disable lingui/no-unlocalized-strings -- CSS values */
const color = (value: string | undefined): string | undefined =>
  value && /^#?[a-fA-F0-9]{6}$/.test(value)
    ? `#${value.replace(/^#/, "")}`
    : undefined;
const points = (value: number | undefined) =>
  value === undefined ? undefined : `${value / 12}em`;
const highlights: Record<string, string> = {
  black: "000000",
  blue: "0000FF",
  cyan: "00FFFF",
  green: "00FF00",
  magenta: "FF00FF",
  red: "FF0000",
  yellow: "FFFF00",
  white: "FFFFFF",
  darkBlue: "000080",
  darkCyan: "008080",
  darkGreen: "008000",
  darkMagenta: "800080",
  darkRed: "800000",
  darkYellow: "808000",
  darkGray: "808080",
  lightGray: "C0C0C0",
};
const border = (value: WordBorder | undefined): string | undefined =>
  value &&
  (value.style === "none"
    ? "none"
    : `${points(value.width ?? 0.5)} ${{ single: "solid", double: "double", dotted: "dotted", dashed: "dashed", thick: "solid" }[value.style]} ${color(value.color) ?? "currentColor"}`);
/* eslint-enable lingui/no-unlocalized-strings */
function runStyle(value: WordRunFormatting): CSSProperties {
  return {
    fontFamily: value.fontFamily,
    fontSize: points(value.fontSize),
    color: color(value.color),
    backgroundColor:
      color(value.highlight ? highlights[value.highlight] : undefined) ??
      color(value.shading),
    fontWeight:
      value.bold === undefined ? undefined : value.bold ? "bold" : "normal",
    fontStyle:
      value.italic === undefined
        ? undefined
        : value.italic
          ? "italic"
          : "normal",
    fontVariant:
      value.smallCaps === undefined
        ? undefined
        : value.smallCaps
          ? "small-caps"
          : "normal",
    textTransform:
      value.caps === undefined ? undefined : value.caps ? "uppercase" : "none",
    textDecorationLine:
      [
        value.underline || value.underlineStyle ? "underline" : "",
        value.strike ? "line-through" : "",
      ]
        .filter(Boolean)
        .join(" ") || undefined,
    textDecorationStyle:
      value.underlineStyle === "wave"
        ? "wavy"
        : value.underlineStyle === "dash"
          ? "dashed"
          : value.underlineStyle === "single"
            ? "solid"
            : value.underlineStyle,
    verticalAlign:
      value.verticalAlign === "superscript"
        ? "super"
        : value.verticalAlign === "subscript"
          ? "sub"
          : value.verticalAlign,
    letterSpacing: points(value.characterSpacing),
  };
}
function paragraphStyle(
  value: WordParagraphFormatting | undefined,
): CSSProperties {
  if (!value) return {};
  return {
    textAlign: value.alignment,
    marginBlockStart: points(value.spacingBefore),
    marginBlockEnd: points(value.spacingAfter),
    marginInlineStart: points(value.indentLeft),
    marginInlineEnd: points(value.indentRight),
    textIndent: points(value.firstLineIndent),
    lineHeight:
      value.lineSpacing?.rule === "multiple"
        ? value.lineSpacing.value
        : points(value.lineSpacing?.value),
    backgroundColor: color(value.shading),
    borderTop: border(value.borders?.top),
    borderRight: border(value.borders?.right),
    borderBottom: border(value.borders?.bottom),
    borderLeft: border(value.borders?.left),
  };
}
function cellStyle(value: WordTableCellFormatting | undefined): CSSProperties {
  if (!value) return {};
  return {
    backgroundColor: color(value.shading),
    verticalAlign:
      value.verticalAlign === "center" ? "middle" : value.verticalAlign,
    writingMode:
      value.textDirection === "vertical"
        ? "vertical-rl"
        : value.textDirection === "vertical270"
          ? "vertical-lr"
          : undefined,
    paddingTop: points(value.margins?.top),
    paddingRight: points(value.margins?.right),
    paddingBottom: points(value.margins?.bottom),
    paddingLeft: points(value.margins?.left),
    borderTop: border(value.borders?.top),
    borderRight: border(value.borders?.right),
    borderBottom: border(value.borders?.bottom),
    borderLeft: border(value.borders?.left),
  };
}

export function WordTablePreview({
  block,
  snapshot,
  maxRows,
}: {
  block: WordTableBlock<WordPlanBlock>;
  snapshot: WordAuthoringSnapshot;
  maxRows?: number;
}) {
  const original = useMemo(
    () => wordSourceTable(snapshot, block.sourceRef),
    [snapshot, block.sourceRef],
  );
  const columnCount =
    block.rows[0]?.cells.reduce((sum, cell) => sum + (cell.colSpan ?? 1), 0) ||
    0;
  const columns =
    block.columns ??
    (original?.columns.length === columnCount ? original.columns : []);
  const format = { ...original?.format, ...block.format };
  const total = columns.reduce((sum, width) => sum + width, 0);
  const rows = block.rows.length;
  return (
    <Card variant="surface" size="sm" className="word-rich-preview">
      <div
        className="word-rich-preview__table-scroll"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to scroll wide tables.
        tabIndex={0}
        role="region"
        aria-label={t({
          id: "officeAddin.word.rich.tableContents",
          message: "Table contents",
        })}
      >
        <table
          className="docx-preview-theme word-rich-preview__paper word-rich-preview__table"
          style={{
            minWidth: `${Math.max(columnCount, 1) * 6}em`,
            backgroundColor: color(format.shading),
            borderTop: border(format.borders?.top),
            borderRight: border(format.borders?.right),
            borderBottom: border(format.borders?.bottom),
            borderLeft: border(format.borders?.left),
          }}
        >
          <caption>
            {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty caption falls back too */}
            <strong>{format.caption || nativeKindLabel("table")}</strong>{" "}
            <span className="word-rich-preview__hint">
              {t({
                id: "officeAddin.word.rich.tableDimensions",
                message: `${rows} rows · ${columnCount} columns`,
              })}
            </span>
          </caption>
          {!!columns.length && (
            <colgroup>
              {columns.map((width, i) => (
                <col
                  key={i}
                  style={{
                    width: total ? `${(100 * width) / total}%` : undefined,
                  }}
                />
              ))}
            </colgroup>
          )}
          <tbody>
            {block.rows.slice(0, maxRows).map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.cells.map((cell, cellIndex) => {
                  const retained = original?.rows
                    .find((r) => r.sourceIndex === row.sourceIndex)
                    ?.cells.find((c) => c.sourceIndex === cell.sourceIndex);
                  const Tag =
                    row.format?.repeatHeader ||
                    (rowIndex === 0 && format.firstRow)
                      ? "th"
                      : "td";
                  return (
                    <Tag
                      key={cellIndex}
                      scope={Tag === "th" ? "col" : undefined}
                      colSpan={cell.colSpan}
                      rowSpan={cell.rowSpan}
                      style={cellStyle({ ...retained?.format, ...cell.format })}
                    >
                      {cell.textEdit ? (
                        <CellTextEdit
                          before={cell.textEdit.expectedText}
                          after={cell.textEdit.text}
                        />
                      ) : cell.blocks === undefined ? (
                        <p className="word-rich-preview__text word-rich-preview__retained">
                          {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty cell gets the label too */}
                          {retained?.text || emptyCellLabel()}
                        </p>
                      ) : cell.blocks.length ? (
                        <WordRichBlockSequence
                          blocks={cell.blocks}
                          snapshot={snapshot}
                        />
                      ) : (
                        <span className="word-rich-preview__hint">
                          {emptyCellLabel()}
                        </span>
                      )}
                    </Tag>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** del/ins are not announced by most screen readers, so name each side. */
export function WordChangeSide({ side }: { side: "before" | "after" }) {
  return (
    <span className="sr-only">
      {side === "before"
        ? t({ id: "officeAddin.word.rich.before", message: "Before:" })
        : t({ id: "officeAddin.word.rich.after", message: "After:" })}{" "}
    </span>
  );
}

export function CellTextEdit({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  return (
    <p className="word-rich-preview__text">
      {before && before !== after && (
        <>
          <del className="word-rich-preview__removed">
            <WordChangeSide side="before" />
            {before}
          </del>{" "}
        </>
      )}
      <ins className="word-rich-preview__inserted">
        {before && before !== after && <WordChangeSide side="after" />}
        {after || emptyCellLabel()}
      </ins>
    </p>
  );
}

/** Host-captured raster data only; never turn a model string into a remote URL. */
const imagePackages = new WeakMap<WordAuthoringSnapshot, Document>();
function inlineImage(
  spec: WordImageSpec,
  snapshot: WordAuthoringSnapshot,
): string | undefined {
  let data =
    spec.data ?? snapshot.assets?.find((asset) => asset.ref === spec.assetRef);
  if (!data && spec.sourceRef) {
    const source = resolveWordSource(snapshot, spec.sourceRef);
    if (source) {
      let packageDoc = imagePackages.get(snapshot);
      if (!packageDoc) {
        packageDoc = new DOMParser().parseFromString(
          snapshot.ooxml,
          // eslint-disable-next-line lingui/no-unlocalized-strings -- MIME type
          "application/xml",
        );
        imagePackages.set(snapshot, packageDoc);
      }
      data = readWordImageData(
        packageDoc,
        source.xml,
        source.index ?? spec.sourceIndex ?? 0,
        source.part,
      );
    }
  }
  if (
    !data ||
    !isWordImageSpec({ data: { mime: data.mime, base64: data.base64 } })
  )
    return undefined;
  // eslint-disable-next-line lingui/no-unlocalized-strings -- data URL
  return `data:${data.mime};base64,${data.base64}`;
}

function ImagePreview({
  image,
  snapshot,
}: {
  image: WordImageSpec;
  snapshot: WordAuthoringSnapshot;
}) {
  const src = useMemo(() => inlineImage(image, snapshot), [image, snapshot]);
  const geometry = useMemo(() => {
    const source = image.sourceRef
      ? resolveWordSource(snapshot, image.sourceRef)
      : undefined;
    const original =
      source && image.sourceRef
        ? inventoryWordMedia(source.xml, image.sourceRef).filter(
            (item) => item.kind === "image",
          )[source.index ?? image.sourceIndex ?? 0]
        : undefined;
    const asset = snapshot.assets?.find((item) => item.ref === image.assetRef);
    const dimensions = image.data ? wordImageDimensions(image.data) : asset;
    const ratio =
      original?.widthPt && original.heightPt
        ? original.widthPt / original.heightPt
        : dimensions
          ? dimensions.widthPx / dimensions.heightPx
          : 1.5;
    const defaultWidth =
      original?.widthPt ?? Math.min(432, (dimensions?.widthPx ?? 288) * 0.75);
    const width =
      image.widthPt ?? (image.heightPt ? image.heightPt * ratio : defaultWidth);
    return {
      widthPt: width,
      heightPt: image.heightPt ?? width / ratio,
    };
  }, [image, snapshot]);
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty text falls back too
  const alt = image.alt || image.title || imageLabel();
  return (
    <Card variant="surface" size="sm" className="word-rich-preview">
      <figure
        className="word-rich-preview__media"
        style={{ textAlign: image.alignment }}
      >
        {src ? (
          <span
            className="docx-preview-theme word-rich-preview__paper word-rich-preview__image-frame"
            style={{
              width: points(geometry.widthPt),
              aspectRatio: `${geometry.widthPt}/${geometry.heightPt}`,
              transform: image.rotation
                ? `rotate(${image.rotation}deg)`
                : undefined,
              border: image.border
                ? `${points(image.border.widthPt)} solid ${color(image.border.color) ?? "currentColor"}`
                : undefined,
            }}
          >
            <img
              src={src}
              alt={alt}
              className="word-rich-preview__image"
              style={{
                width: `${10000 / (100 - (image.crop?.left ?? 0) - (image.crop?.right ?? 0))}%`,
                height: `${10000 / (100 - (image.crop?.top ?? 0) - (image.crop?.bottom ?? 0))}%`,
                left: `${(-100 * (image.crop?.left ?? 0)) / (100 - (image.crop?.left ?? 0) - (image.crop?.right ?? 0))}%`,
                top: `${(-100 * (image.crop?.top ?? 0)) / (100 - (image.crop?.top ?? 0) - (image.crop?.bottom ?? 0))}%`,
              }}
            />
          </span>
        ) : (
          <div
            className="word-rich-preview__placeholder"
            role="img"
            aria-label={alt}
          >
            {alt}
          </div>
        )}
        <figcaption>
          <strong>{alt}</strong>
          <MediaDimensions value={geometry} />
          {!src && (
            <span className="word-rich-preview__hint">
              {t({
                id: "officeAddin.word.rich.imageInWord",
                message: "Image appearance is shown in Word.",
              })}
            </span>
          )}
        </figcaption>
      </figure>
    </Card>
  );
}

function MediaDimensions({
  value,
}: {
  value: WordImageSpec | WordDrawingSpec;
}) {
  if (!value.widthPt || !value.heightPt) return null;
  const width = formatCentimeters(value.widthPt);
  const height = formatCentimeters(value.heightPt);
  return (
    <span className="word-rich-preview__hint">
      {t({
        id: "officeAddin.word.rich.mediaSize",
        message: `${width} × ${height} cm`,
      })}
    </span>
  );
}
function DrawingPreview({ drawing }: { drawing: WordDrawingSpec }) {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty text falls back too
  const label = drawing.alt || drawing.title || nativeKindLabel("drawing");
  const fill = color(drawing.fill) ?? "var(--theme-bg-secondary)";
  const line = color(drawing.line?.color) ?? "var(--theme-fg-secondary)";
  const stroke = drawing.line?.widthPt ?? 1;
  const shape = drawing.shape;
  return (
    <Card variant="surface" size="sm" className="word-rich-preview">
      <figure
        className="word-rich-preview__media"
        style={{ textAlign: drawing.alignment }}
      >
        {shape ? (
          <svg
            viewBox="0 0 100 70"
            role="img"
            aria-label={label}
            className="docx-preview-theme word-rich-preview__paper word-rich-preview__drawing"
            style={{
              width: points(drawing.widthPt),
              aspectRatio:
                drawing.widthPt && drawing.heightPt
                  ? `${drawing.widthPt}/${drawing.heightPt}`
                  : undefined,
              transform: drawing.rotation
                ? `rotate(${drawing.rotation}deg)`
                : undefined,
            }}
          >
            <g fill={fill} stroke={line} strokeWidth={stroke}>
              {shape === "ellipse" ? (
                <ellipse cx="50" cy="35" rx="47" ry="32" />
              ) : shape === "triangle" ? (
                <polygon points="50,3 97,67 3,67" />
              ) : shape === "diamond" ? (
                <polygon points="50,3 97,35 50,67 3,35" />
              ) : shape === "rightArrow" ? (
                <polygon points="3,20 65,20 65,3 97,35 65,67 65,50 3,50" />
              ) : shape === "line" ? (
                <line x1="3" y1="35" x2="97" y2="35" />
              ) : (
                <rect
                  x="3"
                  y="3"
                  width="94"
                  height="64"
                  rx={shape === "roundRect" ? 10 : 0}
                />
              )}
            </g>
          </svg>
        ) : (
          <div
            className="word-rich-preview__placeholder"
            role="img"
            aria-label={label}
          >
            {label}
          </div>
        )}
        <figcaption>
          <strong>{label}</strong>
          <MediaDimensions value={drawing} />
        </figcaption>
        {drawing.text && (
          <p className="word-rich-preview__text">{drawing.text}</p>
        )}
      </figure>
    </Card>
  );
}

function editLabel(edit: WordNativeStructureEdit<WordPlanBlock>) {
  const labels = {
    field: nativeKindLabel("field"),
    bookmark: nativeKindLabel("bookmark"),
    "content-control": nativeKindLabel("content-control"),
    image: imageLabel(),
    drawing: nativeKindLabel("drawing"),
  };
  const label = labels[edit.kind];
  return edit.operation === "delete"
    ? t({
        id: "officeAddin.word.rich.removeObject",
        message: `Remove ${label}`,
      })
    : edit.operation === "unwrap"
      ? t({
          id: "officeAddin.word.rich.unwrapObject",
          message: `Remove ${label}, keep its content`,
        })
      : t({
          id: "officeAddin.word.rich.updateObject",
          message: `Update ${label}`,
        });
}
function NativeEditPreview({
  block,
  snapshot,
}: PreviewProps & { block: Extract<WordPlanBlock, { type: "native-edit" }> }) {
  const original = useMemo(() => {
    const source = resolveWordSource(snapshot, block.sourceRef);
    return source
      ? (wordSourceDetails(source.xml, block.sourceRef).objects ?? [])
      : [];
  }, [snapshot, block.sourceRef]);
  return (
    <Card variant="surface" size="sm" className="word-rich-preview">
      <strong>
        {t({
          id: "officeAddin.word.rich.objectChanges",
          message: "Changes to existing content",
        })}
      </strong>
      <ul className="word-rich-preview__changes">
        {block.edits.map((edit, i) => {
          const old = original.find((entry) => entry.target === edit.target);
          const oldText = typeof old?.text === "string" ? old.text : undefined;
          return (
            <li key={i}>
              <strong>{editLabel(edit)}</strong>
              {edit.operation === "delete" ? (
                oldText && (
                  <p className="word-rich-preview__text">
                    <del>{oldText}</del>
                  </p>
                )
              ) : (
                <>
                  {(edit.kind === "field" || edit.kind === "bookmark") && (
                    <p className="word-rich-preview__text">
                      {edit.text ?? oldText}
                    </p>
                  )}
                  {edit.kind === "field" && edit.instruction && (
                    <FieldCode instruction={edit.instruction} />
                  )}
                  {edit.kind === "bookmark" && edit.name && (
                    <span className="word-rich-preview__hint">{edit.name}</span>
                  )}
                  {edit.kind === "content-control" && edit.title && (
                    <span className="word-rich-preview__hint">
                      {edit.title}
                    </span>
                  )}
                  {edit.kind === "content-control" && (
                    <ControlDetails value={edit} />
                  )}
                  {edit.kind === "content-control" && edit.children && (
                    <WordRichBlockSequence
                      blocks={edit.children}
                      snapshot={snapshot}
                    />
                  )}
                  {edit.kind === "image" && edit.image && (
                    <ImagePreview
                      image={{
                        sourceRef: block.sourceRef,
                        sourceIndex: Number(edit.target.split("-")[1]) - 1,
                        ...edit.image,
                      }}
                      snapshot={snapshot}
                    />
                  )}
                  {edit.kind === "drawing" && edit.drawing && (
                    <DrawingPreview drawing={edit.drawing} />
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function WordRichBlockPreview({
  block,
  snapshot,
  maxTableRows,
}: PreviewProps) {
  if (block.type === "table")
    return (
      <WordTablePreview
        block={block}
        snapshot={snapshot}
        maxRows={maxTableRows}
      />
    );
  if (block.type === "image")
    return <ImagePreview image={block.image} snapshot={snapshot} />;
  if (block.type === "drawing")
    return <DrawingPreview drawing={block.drawing} />;
  if (block.type === "native-edit")
    return <NativeEditPreview block={block} snapshot={snapshot} />;
  if (block.type === "field")
    return (
      <Card variant="surface" size="sm" className="word-rich-preview">
        <span className="word-rich-preview__hint">
          {nativeKindLabel("field")}
        </span>
        <p className="word-rich-preview__text">
          {block.field.text ||
            t({
              id: "officeAddin.word.rich.fieldInWord",
              message: "Value is calculated in Word.",
            })}
        </p>
        <FieldCode instruction={block.field.instruction} />
      </Card>
    );
  if (block.type === "bookmark" || block.type === "content-control") {
    const label =
      block.type === "bookmark"
        ? block.bookmark.name
        : // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty title falls back too
          block.control.title || nativeKindLabel("content-control");
    return (
      <Card variant="surface" size="sm" className="word-rich-preview">
        <span className="word-rich-preview__hint">{label}</span>
        {block.type === "content-control" && (
          <ControlDetails value={block.control} />
        )}
        <WordRichBlockSequence
          blocks={
            block.type === "bookmark"
              ? block.bookmark.children
              : block.control.children
          }
          snapshot={snapshot}
        />
      </Card>
    );
  }
  return (
    <p
      className={`docx-preview-theme word-rich-preview__paper word-rich-preview__text${block.type === "heading" ? " word-rich-preview__heading" : ""}`}
      role={block.type === "heading" ? "heading" : undefined}
      aria-level={block.type === "heading" ? block.level : undefined}
      style={paragraphStyle(block.format)}
    >
      {(block.runs ?? [{ text: block.text }]).map((run, i) => (
        <span
          key={i}
          lang={run.language ?? block.format?.font?.language}
          style={runStyle({ ...block.format?.font, ...run })}
        >
          {run.text}
        </span>
      ))}
    </p>
  );
}

function FieldCode({ instruction }: { instruction: string }) {
  return (
    <span className="word-rich-preview__hint">
      {t({
        id: "officeAddin.word.rich.fieldCode",
        message: `Field code: ${instruction}`,
      })}
    </span>
  );
}

function ControlDetails({
  value,
}: {
  value: {
    tag?: string;
    lock?: "none" | "content" | "control" | "both";
    binding?: "retain" | "remove";
  };
}) {
  const { tag } = value;
  return (
    <>
      {tag && (
        <span className="word-rich-preview__hint">
          {t({
            id: "officeAddin.word.rich.controlTag",
            message: `Tag: ${tag}`,
          })}
        </span>
      )}
      {value.lock !== undefined && (
        <span className="word-rich-preview__hint">
          {value.lock === "none"
            ? t({
                id: "officeAddin.word.rich.controlUnlocked",
                message: "Content can be edited; the control can be removed.",
              })
            : value.lock === "content"
              ? t({
                  id: "officeAddin.word.rich.contentLocked",
                  message: "Content is locked; the control can be removed.",
                })
              : value.lock === "control"
                ? t({
                    id: "officeAddin.word.rich.controlLocked",
                    message:
                      "Content can be edited; the control cannot be removed.",
                  })
                : t({
                    id: "officeAddin.word.rich.bothLocked",
                    message:
                      "Content is locked; the control cannot be removed.",
                  })}
        </span>
      )}
      {value.binding === "remove" && (
        <span className="word-rich-preview__hint">
          {t({
            id: "officeAddin.word.rich.bindingRemoved",
            message: "Remove the link to document data.",
          })}
        </span>
      )}
    </>
  );
}

export function WordRichBlockSequence({
  blocks,
  snapshot,
  maxTableRows,
}: {
  blocks: WordPlanBlock[];
  snapshot: WordAuthoringSnapshot;
  maxTableRows?: number;
}) {
  const ordinalOf = createWordListNumbering();
  return (
    <>
      {blocks.map((block) => {
        const ordinal = ordinalOf(block);
        if (ordinal === undefined)
          return (
            <WordRichBlockPreview
              key={block.id}
              block={block}
              snapshot={snapshot}
              maxTableRows={maxTableRows}
            />
          );
        return (
          <div
            key={block.id}
            className="word-rich-preview__list-item"
            style={{ marginInlineStart: `${block.level ?? 0}em` }}
          >
            <span aria-hidden="true">
              {block.ordered ? `${ordinal}.` : "•"}
            </span>
            <WordRichBlockPreview block={block} snapshot={snapshot} />
          </div>
        );
      })}
    </>
  );
}
