import { Card } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useMemo } from "react";

import {
  inventoryWordMedia,
  isWordImageSpec,
  readWordImageData,
  wordImageDimensions,
} from "../utils/wordMediaContent";
import { resolveWordSource, wordSourceDetails } from "../utils/wordRichContent";
import { readWordTableContent } from "../utils/wordTableContent";

import type {
  WordBorder,
  WordParagraphFormatting,
  WordRunFormatting,
} from "../utils/wordBlockFormatting";
import type {
  WordAuthoringSnapshot,
  WordPlanBlock,
} from "../utils/wordDocumentPlan";
import type { WordNativeStructureEdit } from "../utils/wordInlineStructures";
import type { WordDrawingSpec, WordImageSpec } from "../utils/wordMediaContent";
import type {
  WordTableBlock,
  WordTableCellFormatting,
  WordTableContent,
} from "../utils/wordTableContent";
import type { CSSProperties } from "react";

import "./wordRichPreview.css";

type PreviewProps = { block: WordPlanBlock; snapshot: WordAuthoringSnapshot };
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

function sourceTable(
  snapshot: WordAuthoringSnapshot,
  ref: string | undefined,
): WordTableContent<WordPlanBlock> | undefined {
  if (!ref) return undefined;
  const block = snapshot.blocks.find((source) => source.ref === ref);
  if (block?.content) return block.content;
  const source = resolveWordSource(snapshot, ref);
  if (!source) return undefined;
  const root = new DOMParser().parseFromString(
    source.xml,
    "application/xml",
  ).documentElement;
  const tables = [
    root,
    ...Array.from(
      root.getElementsByTagNameNS(
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        "tbl",
      ),
    ),
  ].filter((e, i, all) => e.localName === "tbl" && all.indexOf(e) === i);
  const table = tables[source.index ?? 0];
  return table ? readWordTableContent<WordPlanBlock>(table) : undefined;
}

function TablePreview({
  block,
  snapshot,
}: {
  block: WordTableBlock<WordPlanBlock>;
  snapshot: WordAuthoringSnapshot;
}) {
  const original = useMemo(
    () => sourceTable(snapshot, block.sourceRef),
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
            <strong>
              {format.caption ||
                t({
                  id: "officeAddin.word.authoring.nativeTable",
                  message: "Table",
                })}
            </strong>{" "}
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
            {block.rows.map((row, rowIndex) => (
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
                      {cell.blocks === undefined ? (
                        <>
                          <p className="word-rich-preview__text">
                            {retained?.text ||
                              t({
                                id: "officeAddin.word.rich.emptyCell",
                                message: "Empty cell",
                              })}
                          </p>
                          <span className="word-rich-preview__hint">
                            {t({
                              id: "officeAddin.word.rich.cellRetained",
                              message: "Existing content retained",
                            })}
                          </span>
                        </>
                      ) : cell.blocks.length ? (
                        <WordRichBlockSequence
                          blocks={cell.blocks}
                          snapshot={snapshot}
                        />
                      ) : (
                        <span className="word-rich-preview__hint">
                          {t({
                            id: "officeAddin.word.rich.emptyCell",
                            message: "Empty cell",
                          })}
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
    const original = source
      ? inventoryWordMedia(source.xml, image.sourceRef!).filter(
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
  const alt =
    image.alt ||
    image.title ||
    t({ id: "officeAddin.word.rich.image", message: "Image" });
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
  return value.widthPt && value.heightPt ? (
    <span className="word-rich-preview__hint">
      {t({
        id: "officeAddin.word.rich.mediaDimensions",
        message: `${value.widthPt} × ${value.heightPt} pt`,
      })}
    </span>
  ) : null;
}
function DrawingPreview({ drawing }: { drawing: WordDrawingSpec }) {
  const label =
    drawing.alt ||
    drawing.title ||
    t({ id: "officeAddin.word.rich.drawing", message: "Drawing" });
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
    field: t({
      id: "officeAddin.word.authoring.nativeField",
      message: "Document field",
    }),
    bookmark: t({ id: "officeAddin.word.rich.bookmark", message: "Bookmark" }),
    "content-control": t({
      id: "officeAddin.word.authoring.nativeControl",
      message: "Content control",
    }),
    image: t({ id: "officeAddin.word.rich.image", message: "Image" }),
    drawing: t({ id: "officeAddin.word.rich.drawing", message: "Drawing" }),
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

export function WordRichBlockPreview({ block, snapshot }: PreviewProps) {
  if (block.type === "table")
    return <TablePreview block={block} snapshot={snapshot} />;
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
          {t({
            id: "officeAddin.word.authoring.nativeField",
            message: "Document field",
          })}
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
        : block.control.title ||
          t({
            id: "officeAddin.word.authoring.nativeControl",
            message: "Content control",
          });
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
  return (
    <>
      {value.tag && (
        <span className="word-rich-preview__hint">
          {t({
            id: "officeAddin.word.rich.controlTag",
            message: `Tag: ${value.tag}`,
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
}: {
  blocks: WordPlanBlock[];
  snapshot: WordAuthoringSnapshot;
}) {
  const counts = new Map<string, number>();
  return (
    <>
      {blocks.map((block) => {
        if (block.type !== "list-item")
          return (
            <WordRichBlockPreview
              key={block.id}
              block={block}
              snapshot={snapshot}
            />
          );
        for (const key of counts.keys()) {
          const [list, level] = key.split(":");
          if (list === block.list && Number(level) > (block.level ?? 0))
            counts.delete(key);
        }
        const key = `${block.list}:${block.level ?? 0}`;
        const ordinal = (counts.get(key) ?? 0) + 1;
        counts.set(key, ordinal);
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
