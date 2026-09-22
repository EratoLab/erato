import { isWordMediaElementActive } from "./wordMediaComparison";

/** Typed DrawingML authoring. Model text never becomes XML or a fetched URL. */
export interface WordImageSpec {
  sourceRef?: string;
  assetRef?: string;
  sourceIndex?: number;
  data?: { mime: "image/png" | "image/jpeg" | "image/gif"; base64: string };
  widthPt?: number;
  heightPt?: number;
  alt?: string;
  title?: string;
  alignment?: "left" | "center" | "right";
  rotation?: number;
  crop?: { left: number; right: number; top: number; bottom: number };
  border?: { color: string; widthPt: number };
  wrap?: "inline" | "square" | "top-bottom" | "behind" | "front";
}

export interface WordDrawingSpec {
  sourceRef?: string;
  sourceIndex?: number;
  shape?:
    | "rect"
    | "roundRect"
    | "ellipse"
    | "line"
    | "triangle"
    | "diamond"
    | "rightArrow";
  text?: string;
  widthPt?: number;
  heightPt?: number;
  alt?: string;
  title?: string;
  alignment?: "left" | "center" | "right";
  rotation?: number;
  fill?: string;
  line?: { color: string; widthPt: number };
  wrap?: WordImageSpec["wrap"];
}

export interface WordMediaSource {
  sourceXml?: string;
  sourcePart?: string;
  storyPart?: string;
  /** A surgical update keeps the targeted object's native identity. */
  preserveIds?: boolean;
}

export interface WordMediaObject {
  ref: string;
  target: string;
  kind: "image" | "drawing";
  sourceIndex: number;
  widthPt?: number;
  heightPt?: number;
  alt?: string;
  title?: string;
  text?: string;
  shape?: string;
  wrap?: WordImageSpec["wrap"];
  rotation?: number;
  crop?: WordImageSpec["crop"];
  border?: WordImageSpec["border"];
  fill?: string;
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const WP =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const WPS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";
const VML = "urn:schemas-microsoft-com:vml";
const W10 = "urn:schemas-microsoft-com:office:word";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const EMU = 12700;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
type NativeIdKind = "drawing" | "bookmark" | "control";
const nativeIds = new WeakMap<Document, Record<NativeIdKind, Set<number>>>();
const legacyIds = new WeakMap<Document, Set<string>>();

/** Call before clearing the source body so generated objects cannot reuse kept IDs. */
export function reserveWordNativeIds(doc: Document) {
  const reserved = nativeIds.get(doc) ?? {
    drawing: new Set<number>(),
    bookmark: new Set<number>(),
    control: new Set<number>(),
  };
  for (const [kind, namespace, local, attributeNamespace, attribute] of [
    ["drawing", WP, "docPr", null, "id"],
    ["bookmark", W, "bookmarkStart", W, "id"],
    ["control", W, "id", W, "val"],
  ] as const) {
    for (const element of doc.getElementsByTagNameNS(namespace, local)) {
      if (kind === "control" && element.parentElement?.localName !== "sdtPr")
        continue;
      const value = Number(
        element.getAttributeNS(attributeNamespace, attribute),
      );
      if (Number.isSafeInteger(value)) reserved[kind].add(value);
    }
  }
  nativeIds.set(doc, reserved);
  const legacy = legacyIds.get(doc) ?? new Set<string>();
  for (const node of doc.getElementsByTagNameNS(VML, "*")) {
    const identifier = node.getAttribute("id");
    if (identifier) legacy.add(identifier);
  }
  legacyIds.set(doc, legacy);
}

export function allocateWordNativeId(doc: Document, kind: NativeIdKind) {
  if (!nativeIds.has(doc)) reserveWordNativeIds(doc);
  const used = nativeIds.get(doc)![kind];
  const maximum = Math.max(0, ...used);
  let next = maximum < 2147483647 ? maximum + 1 : 1;
  while (used.has(next)) next++;
  if (next > 2147483647) throw new Error("Native object ID space exhausted");
  used.add(next);
  return String(next);
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) =>
  Object.keys(v).every((key) => allowed.includes(key));
const finite = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const safeText = (v: unknown, max = 4000): v is string =>
  typeof v === "string" &&
  v.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const color = (v: unknown): v is string =>
  typeof v === "string" && /^(?:[\dA-Fa-f]{6}|none)$/.test(v);
const border = (v: unknown) =>
  record(v) &&
  keys(v, ["color", "widthPt"]) &&
  color(v.color) &&
  finite(v.widthPt, 0, 100);
const common = (v: Record<string, unknown>) =>
  (v.sourceRef === undefined ||
    (typeof v.sourceRef === "string" &&
      /^[a-zA-Z0-9_-]{1,150}$/.test(v.sourceRef))) &&
  (v.sourceIndex === undefined ||
    (finite(v.sourceIndex, 0, 2000) &&
      Number.isInteger(v.sourceIndex) &&
      v.sourceRef !== undefined)) &&
  [v.widthPt, v.heightPt].every(
    (n) => n === undefined || finite(n, 0.1, 1584),
  ) &&
  [v.alt, v.title].every((s) => s === undefined || safeText(s)) &&
  (v.alignment === undefined ||
    ["left", "center", "right"].includes(v.alignment as string)) &&
  (v.rotation === undefined || finite(v.rotation, -360, 360)) &&
  (v.wrap === undefined ||
    ["inline", "square", "top-bottom", "behind", "front"].includes(
      v.wrap as string,
    ));

function imageData(v: unknown): v is NonNullable<WordImageSpec["data"]> {
  if (
    !record(v) ||
    !keys(v, ["mime", "base64"]) ||
    !["image/png", "image/jpeg", "image/gif"].includes(v.mime as string) ||
    typeof v.base64 !== "string" ||
    v.base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      v.base64,
    )
  )
    return false;
  try {
    const bytes = atob(v.base64);
    if (!bytes || bytes.length > MAX_IMAGE_BYTES) return false;
    if (v.mime === "image/png")
      return bytes.startsWith("\x89PNG\r\n\x1a\n") && bytes.length >= 24;
    if (v.mime === "image/jpeg")
      return bytes.startsWith("\xff\xd8\xff") && bytes.length >= 4;
    return (
      (bytes.startsWith("GIF87a") || bytes.startsWith("GIF89a")) &&
      bytes.length >= 10
    );
  } catch {
    return false;
  }
}

/** Header dimensions are bounded before Word decodes the user-supplied image. */
export function wordImageDimensions(
  data: NonNullable<WordImageSpec["data"]>,
): { widthPx: number; heightPx: number } | undefined {
  if (!imageData(data)) return undefined;
  const binary = atob(data.base64);
  const byte = (index: number) => binary.charCodeAt(index);
  const uint16 = (index: number) => byte(index) * 256 + byte(index + 1);
  const uint32 = (index: number) =>
    byte(index) * 16777216 +
    byte(index + 1) * 65536 +
    byte(index + 2) * 256 +
    byte(index + 3);
  let widthPx = 0,
    heightPx = 0;
  if (data.mime === "image/png" && binary.slice(12, 16) === "IHDR") {
    widthPx = uint32(16);
    heightPx = uint32(20);
  } else if (data.mime === "image/gif") {
    widthPx = byte(6) + byte(7) * 256;
    heightPx = byte(8) + byte(9) * 256;
  } else if (data.mime === "image/jpeg") {
    let offset = 2;
    while (offset + 8 < binary.length) {
      if (byte(offset++) !== 0xff) break;
      while (byte(offset) === 0xff) offset++;
      const marker = byte(offset++);
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      const length = uint16(offset);
      if (length < 2 || offset + length > binary.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        heightPx = uint16(offset + 3);
        widthPx = uint16(offset + 5);
        break;
      }
      offset += length;
    }
  }
  if (
    !Number.isInteger(widthPx) ||
    !Number.isInteger(heightPx) ||
    widthPx <= 0 ||
    heightPx <= 0 ||
    widthPx * heightPx > 50_000_000
  )
    return undefined;
  return { widthPx, heightPx };
}

export function isWordImageSpec(value: unknown): value is WordImageSpec {
  if (
    !record(value) ||
    !keys(value, [
      "sourceRef",
      "assetRef",
      "sourceIndex",
      "data",
      "widthPt",
      "heightPt",
      "alt",
      "title",
      "alignment",
      "rotation",
      "crop",
      "border",
      "wrap",
    ]) ||
    !common(value)
  )
    return false;
  if (!value.sourceRef && !value.assetRef && value.data === undefined)
    return false;
  if (
    value.assetRef !== undefined &&
    (typeof value.assetRef !== "string" ||
      !/^[a-zA-Z0-9_-]{1,150}$/.test(value.assetRef) ||
      value.data !== undefined)
  )
    return false;
  if (value.data !== undefined && !imageData(value.data)) return false;
  if (value.crop !== undefined) {
    if (
      !record(value.crop) ||
      !keys(value.crop, ["left", "right", "top", "bottom"]) ||
      ![
        value.crop.left,
        value.crop.right,
        value.crop.top,
        value.crop.bottom,
      ].every((n) => finite(n, 0, 99)) ||
      Number(value.crop.left) + Number(value.crop.right) >= 100 ||
      Number(value.crop.top) + Number(value.crop.bottom) >= 100
    )
      return false;
  }
  return value.border === undefined || border(value.border);
}

export function isWordDrawingSpec(value: unknown): value is WordDrawingSpec {
  return (
    record(value) &&
    keys(value, [
      "sourceRef",
      "sourceIndex",
      "shape",
      "text",
      "widthPt",
      "heightPt",
      "alt",
      "title",
      "alignment",
      "rotation",
      "fill",
      "line",
      "wrap",
    ]) &&
    common(value) &&
    (value.sourceRef !== undefined || value.shape !== undefined) &&
    (value.shape === undefined ||
      [
        "rect",
        "roundRect",
        "ellipse",
        "line",
        "triangle",
        "diamond",
        "rightArrow",
      ].includes(value.shape as string)) &&
    (value.text === undefined || safeText(value.text, 32000)) &&
    (value.fill === undefined || color(value.fill)) &&
    (value.line === undefined || border(value.line))
  );
}

const descendants = (
  node: Element | Document,
  namespace: string,
  local: string,
) => Array.from(node.getElementsByTagNameNS(namespace, local));
const child = (node: Element, namespace: string, local: string) =>
  Array.from(node.children).find(
    (c) => c.namespaceURI === namespace && c.localName === local,
  );
const make = (
  doc: Document,
  namespace: string,
  name: string,
  attributes: Record<string, string | number> = {},
) => {
  const e = doc.createElementNS(namespace, name);
  for (const [key, value] of Object.entries(attributes))
    e.setAttribute(key, String(value));
  return e;
};
function parseFragment(source: string): Element {
  if (/<!DOCTYPE/i.test(source)) throw new Error("Invalid media source");
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (doc.getElementsByTagName("parsererror").length)
    throw new Error("Invalid media source");
  return doc.documentElement;
}
function mediaNodes(root: Element) {
  const drawings =
    root.namespaceURI === W && root.localName === "drawing"
      ? [root]
      : descendants(root, W, "drawing");
  const pictures =
    root.namespaceURI === W && root.localName === "pict"
      ? [root]
      : descendants(root, W, "pict");
  return [...drawings, ...pictures].filter(isWordMediaElementActive);
}
function isImage(node: Element) {
  return (
    descendants(node, A, "blip").some((e) => mediaOwner(e) === node) ||
    descendants(node, "urn:schemas-microsoft-com:vml", "imagedata").some(
      (e) => mediaOwner(e) === node,
    )
  );
}
function mediaOwner(node: Element): Element | undefined {
  let parent = node.parentElement;
  while (parent) {
    if (
      parent.namespaceURI === W &&
      ["drawing", "pict"].includes(parent.localName)
    )
      return parent;
    parent = parent.parentElement;
  }
  return undefined;
}
function legacyShape(node: Element) {
  return Array.from(node.getElementsByTagNameNS(VML, "*")).find((e) =>
    [
      "shape",
      "rect",
      "roundrect",
      "oval",
      "line",
      "polyline",
      "curve",
      "arc",
      "group",
    ].includes(e.localName),
  );
}
function legacyStyle(node: Element) {
  return new Map(
    (node.getAttribute("style") ?? "")
      .split(";")
      .map((s) => {
        const [key, ...value] = s.split(":");
        return [key.trim(), value.join(":").trim()] as const;
      })
      .filter(([key]) => key),
  );
}
function legacyPoints(value: string | undefined) {
  const match = /^([\d.]+)(pt|in|cm|mm|px)?$/.exec(value ?? "");
  if (!match) return undefined;
  const points =
    Number(match[1]) *
    ({ pt: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, px: 0.75 }[
      match[2] ?? "pt"
    ] ?? 1);
  return Number.isFinite(points) && points > 0 ? points : undefined;
}
export function inventoryWordMedia(
  source: string | Element,
  sourceRef: string,
): WordMediaObject[] {
  const root = typeof source === "string" ? parseFragment(source) : source;
  const counts = { image: 0, drawing: 0 };
  return mediaNodes(root).map((node) => {
    const kind = isImage(node) ? "image" : "drawing";
    const sourceIndex = counts[kind]++;
    const extent = descendants(node, WP, "extent")[0];
    const properties = descendants(node, WP, "docPr")[0];
    const legacy = legacyShape(node),
      style = legacy ? legacyStyle(legacy) : undefined;
    const width =
      Number(extent?.getAttribute("cx")) ||
      (legacyPoints(style?.get("width")) ?? 0) * EMU;
    const height =
      Number(extent?.getAttribute("cy")) ||
      (legacyPoints(style?.get("height")) ?? 0) * EMU;
    const anchor = descendants(node, WP, "anchor")[0];
    const legacyWrap = legacy
      ? descendants(legacy, W10, "wrap")[0]?.getAttributeNS(W10, "type")
      : undefined;
    const wrap: WordImageSpec["wrap"] = !anchor
      ? legacyWrap === "square"
        ? "square"
        : legacyWrap === "topAndBottom"
          ? "top-bottom"
          : legacyWrap === "none"
            ? Number(style?.get("z-index")) < 0
              ? "behind"
              : "front"
            : "inline"
      : anchor.getAttribute("behindDoc") === "1"
        ? "behind"
        : child(anchor, WP, "wrapNone")
          ? "front"
          : child(anchor, WP, "wrapTopAndBottom")
            ? "top-bottom"
            : "square";
    const xfrm = descendants(node, A, "xfrm").find(
      (e) => mediaOwner(e) === node,
    );
    const rotation = xfrm?.hasAttribute("rot")
      ? Number(xfrm.getAttribute("rot")) / 60000
      : style?.has("rotation")
        ? Number(style.get("rotation"))
        : undefined;
    const rectangle = descendants(node, A, "srcRect").find(
      (e) => mediaOwner(e) === node,
    );
    const legacyImage = descendants(node, VML, "imagedata")[0];
    const crop = rectangle
      ? (Object.fromEntries(
          ["left", "right", "top", "bottom"].map((side) => [
            side,
            Number(rectangle.getAttribute(side[0]) ?? 0) / 1000,
          ]),
        ) as unknown as WordImageSpec["crop"])
      : undefined;
    const legacyCrop =
      legacyImage &&
      ["left", "right", "top", "bottom"].some((side) =>
        legacyImage.hasAttribute(`crop${side}`),
      )
        ? (Object.fromEntries(
            ["left", "right", "top", "bottom"].map((side) => {
              const value = legacyImage.getAttribute(`crop${side}`) ?? "0";
              return [
                side,
                value.endsWith("f")
                  ? (Number(value.slice(0, -1)) / 65536) * 100
                  : Number(value) * 100,
              ];
            }),
          ) as unknown as WordImageSpec["crop"])
        : undefined;
    const propertiesNode = Array.from(node.getElementsByTagName("*")).find(
      (e) =>
        [PIC, WPS, A].includes(e.namespaceURI ?? "") &&
        e.localName === "spPr" &&
        mediaOwner(e) === node,
    );
    const lineNode = propertiesNode
      ? child(propertiesNode, A, "ln")
      : undefined;
    const lineColor = lineNode
      ? child(lineNode, A, "noFill")
        ? "none"
        : descendants(lineNode, A, "srgbClr")[0]?.getAttribute("val")
      : legacy?.getAttribute("stroked") === "f"
        ? "none"
        : legacy?.getAttribute("strokecolor")?.replace(/^#/, "");
    const lineWidth = lineNode?.hasAttribute("w")
      ? Number(lineNode.getAttribute("w")) / EMU
      : legacyPoints(legacy?.getAttribute("strokeweight") ?? undefined);
    const outline =
      lineColor &&
      /^(?:[a-f\d]{6}|none)$/i.test(lineColor) &&
      lineWidth !== undefined &&
      Number.isFinite(lineWidth)
        ? { color: lineColor, widthPt: lineWidth }
        : undefined;
    const fillNode = propertiesNode
      ? child(propertiesNode, A, "solidFill")
      : undefined;
    const fillColor =
      propertiesNode && child(propertiesNode, A, "noFill")
        ? "none"
        : fillNode
          ? descendants(fillNode, A, "srgbClr")[0]?.getAttribute("val")
          : legacy?.getAttribute("filled") === "f"
            ? "none"
            : legacy?.getAttribute("fillcolor")?.replace(/^#/, "");
    return {
      ref: `${sourceRef}_${kind}_${sourceIndex + 1}`,
      target: `${kind}-${sourceIndex + 1}`,
      kind,
      sourceIndex,
      ...(width > 0 ? { widthPt: width / EMU } : {}),
      ...(height > 0 ? { heightPt: height / EMU } : {}),
      ...((properties?.getAttribute("descr") ?? legacy?.getAttribute("alt"))
        ? {
            alt:
              properties?.getAttribute("descr") ?? legacy!.getAttribute("alt")!,
          }
        : {}),
      ...((properties?.getAttribute("title") ?? legacy?.getAttribute("title"))
        ? {
            title:
              properties?.getAttribute("title") ??
              legacy!.getAttribute("title")!,
          }
        : {}),
      ...(kind === "drawing"
        ? {
            text: descendants(node, W, "t")
              .map((t) => t.textContent ?? "")
              .join(""),
            shape:
              descendants(node, A, "prstGeom")[0]?.getAttribute("prst") ??
              "native",
          }
        : {}),
      wrap,
      ...(rotation !== undefined && Number.isFinite(rotation)
        ? { rotation }
        : {}),
      ...(kind === "image" && (crop || legacyCrop)
        ? { crop: crop ?? legacyCrop }
        : {}),
      ...(outline ? { border: outline } : {}),
      ...(kind === "drawing" &&
      fillColor &&
      /^(?:[a-f\d]{6}|none)$/i.test(fillColor)
        ? { fill: fillColor }
        : {}),
    };
  });
}

function packagePart(doc: Document, path: string) {
  return descendants(doc, PKG, "part").find(
    (p) => p.getAttributeNS(PKG, "name") === path,
  );
}
function createPart(doc: Document, path: string, contentType: string) {
  const pkg = descendants(doc, PKG, "package")[0];
  if (!pkg) throw new Error("Media requires a Word package");
  const part = make(doc, PKG, "pkg:part");
  part.setAttributeNS(PKG, "pkg:name", path);
  part.setAttributeNS(PKG, "pkg:contentType", contentType);
  pkg.append(part);
  return part;
}
function relationshipPath(story: string) {
  const slash = story.lastIndexOf("/");
  return `${story.slice(0, slash + 1)}_rels/${story.slice(slash + 1)}.rels`;
}
function relationships(doc: Document, story: string): Element {
  const path = relationshipPath(story);
  const existing = packagePart(doc, path);
  if (existing) return descendants(existing, REL, "Relationships")[0];
  const part = createPart(
    doc,
    path,
    "application/vnd.openxmlformats-package.relationships+xml",
  );
  const data = make(doc, PKG, "pkg:xmlData");
  const root = make(doc, REL, "Relationships");
  data.append(root);
  part.append(data);
  return root;
}
function absoluteTarget(story: string, target: string) {
  if (target.startsWith("/")) return target;
  const segments =
    `${story.slice(0, story.lastIndexOf("/") + 1)}${target}`.split("/");
  const result: string[] = [];
  for (const segment of segments) {
    if (segment === "..") result.pop();
    else if (segment && segment !== ".") result.push(segment);
  }
  return `/${result.join("/")}`;
}
function relationship(
  doc: Document,
  story: string,
  target: string,
  type: string,
  external?: string,
) {
  const root = relationships(doc, story);
  const same = Array.from(root.children).find(
    (r) =>
      r.getAttribute("Target") === target &&
      r.getAttribute("Type") === type &&
      (r.getAttribute("TargetMode") ?? "") === (external ?? ""),
  );
  if (same) return same.getAttribute("Id")!;
  const ids = new Set(
    Array.from(root.children).map((r) => r.getAttribute("Id")),
  );
  let n = 1;
  while (ids.has(`eratoMedia${n}`)) n++;
  const id = `eratoMedia${n}`;
  root.append(
    make(doc, REL, "Relationship", {
      Id: id,
      Type: type,
      Target: target,
      ...(external ? { TargetMode: external } : {}),
    }),
  );
  return id;
}

/** Rebind only package relationships when an object moves into another story. */
export function rebindWordMediaRelationships(
  doc: Document,
  node: Element,
  sourcePart: string,
  storyPart: string,
) {
  if (sourcePart === storyPart) return;
  const original = packagePart(doc, relationshipPath(sourcePart));
  const sourceRels = original ? descendants(original, REL, "Relationship") : [];
  for (const element of [node, ...Array.from(node.getElementsByTagName("*"))]) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.namespaceURI !== R) continue;
      const source = sourceRels.find(
        (r) => r.getAttribute("Id") === attribute.value,
      );
      if (!source) throw new Error("Missing media relationship");
      const external = source.getAttribute("TargetMode") ?? undefined;
      const target = external
        ? source.getAttribute("Target")!
        : absoluteTarget(sourcePart, source.getAttribute("Target")!);
      element.setAttributeNS(
        R,
        attribute.name,
        relationship(
          doc,
          storyPart,
          target,
          source.getAttribute("Type")!,
          external,
        ),
      );
    }
  }
}

function addImage(
  doc: Document,
  data: NonNullable<WordImageSpec["data"]>,
  story: string,
) {
  const extension =
    data.mime === "image/jpeg" ? "jpg" : data.mime.split("/")[1];
  let n = 1;
  while (packagePart(doc, `/word/media/erato-image-${n}.${extension}`)) n++;
  const path = `/word/media/erato-image-${n}.${extension}`;
  const part = createPart(doc, path, data.mime);
  const binary = make(doc, PKG, "pkg:binaryData");
  binary.textContent = data.base64;
  part.append(binary);
  return relationship(doc, story, path, `${R}/image`);
}
function colorElement(doc: Document, value: string) {
  if (value === "none") return make(doc, A, "a:noFill");
  const fill = make(doc, A, "a:solidFill");
  fill.append(make(doc, A, "a:srgbClr", { val: value.toUpperCase() }));
  return fill;
}
function replaceShapeProperty(
  properties: Element,
  names: string[],
  value: Element,
  before?: string[],
) {
  for (const c of Array.from(properties.children))
    if (c.namespaceURI === A && names.includes(c.localName)) c.remove();
  const next = before
    ? Array.from(properties.children).find(
        (c) => c.namespaceURI === A && before.includes(c.localName),
      )
    : undefined;
  properties.insertBefore(value, next ?? null);
}
function frame(
  doc: Document,
  widthPt: number,
  heightPt: number,
  title: string,
  alt: string,
) {
  const inline = make(doc, WP, "wp:inline", {
    distT: 0,
    distB: 0,
    distL: 0,
    distR: 0,
  });
  inline.append(
    make(doc, WP, "wp:extent", {
      cx: Math.round(widthPt * EMU),
      cy: Math.round(heightPt * EMU),
    }),
    make(doc, WP, "wp:effectExtent", { l: 0, t: 0, r: 0, b: 0 }),
    make(doc, WP, "wp:docPr", {
      id: allocateWordNativeId(doc, "drawing"),
      name: title || "Erato illustration",
      ...(alt ? { descr: alt } : {}),
      ...(title ? { title } : {}),
    }),
  );
  const locks = make(doc, WP, "wp:cNvGraphicFramePr");
  locks.append(make(doc, A, "a:graphicFrameLocks", { noChangeAspect: 1 }));
  inline.append(locks);
  return inline;
}
function transform(doc: Document, widthPt: number, heightPt: number) {
  const xfrm = make(doc, A, "a:xfrm");
  xfrm.append(
    make(doc, A, "a:off", { x: 0, y: 0 }),
    make(doc, A, "a:ext", {
      cx: Math.round(widthPt * EMU),
      cy: Math.round(heightPt * EMU),
    }),
  );
  return xfrm;
}
function picture(doc: Document, relationshipId: string, spec: WordImageSpec) {
  const dimensions = spec.data ? wordImageDimensions(spec.data) : undefined;
  const ratio = dimensions ? dimensions.widthPx / dimensions.heightPx : 1.5;
  const width =
    spec.widthPt ??
    (spec.heightPt
      ? spec.heightPt * ratio
      : Math.min(432, (dimensions?.widthPx ?? 288) * 0.75));
  const height = spec.heightPt ?? width / ratio;
  const drawing = make(doc, W, "w:drawing");
  const inline = frame(doc, width, height, spec.title ?? "", spec.alt ?? "");
  const graphic = make(doc, A, "a:graphic"),
    data = make(doc, A, "a:graphicData", { uri: PIC }),
    pic = make(doc, PIC, "pic:pic");
  const properties = make(doc, PIC, "pic:nvPicPr");
  properties.append(
    make(doc, PIC, "pic:cNvPr", { id: 0, name: spec.title ?? "Picture" }),
    make(doc, PIC, "pic:cNvPicPr"),
  );
  const fill = make(doc, PIC, "pic:blipFill"),
    blip = make(doc, A, "a:blip");
  blip.setAttributeNS(R, "r:embed", relationshipId);
  const stretch = make(doc, A, "a:stretch");
  stretch.append(make(doc, A, "a:fillRect"));
  fill.append(blip, stretch);
  const shape = make(doc, PIC, "pic:spPr");
  const geometry = make(doc, A, "a:prstGeom", { prst: "rect" });
  geometry.append(make(doc, A, "a:avLst"));
  shape.append(transform(doc, width, height), geometry);
  pic.append(properties, fill, shape);
  data.append(pic);
  graphic.append(data);
  inline.append(graphic);
  drawing.append(inline);
  return drawing;
}

function updateFrame(
  doc: Document,
  drawing: Element,
  spec: WordImageSpec | WordDrawingSpec,
  preserveIds = false,
) {
  let container =
    descendants(drawing, WP, "inline")[0] ??
    descendants(drawing, WP, "anchor")[0];
  if (!container) {
    const shape = legacyShape(drawing);
    if (!shape) throw new Error("This native drawing has no editable geometry");
    const declarations = legacyStyle(shape);
    const oldWidth = legacyPoints(declarations.get("width")),
      oldHeight = legacyPoints(declarations.get("height"));
    if (spec.widthPt !== undefined)
      declarations.set("width", `${spec.widthPt}pt`);
    if (spec.heightPt !== undefined)
      declarations.set("height", `${spec.heightPt}pt`);
    if (
      spec.widthPt !== undefined &&
      spec.heightPt === undefined &&
      oldWidth &&
      oldHeight
    )
      declarations.set("height", `${(spec.widthPt * oldHeight) / oldWidth}pt`);
    if (
      spec.heightPt !== undefined &&
      spec.widthPt === undefined &&
      oldWidth &&
      oldHeight
    )
      declarations.set("width", `${(spec.heightPt * oldWidth) / oldHeight}pt`);
    if (spec.rotation !== undefined)
      declarations.set("rotation", String(spec.rotation));
    if (spec.alt !== undefined) shape.setAttribute("alt", spec.alt);
    if (spec.title !== undefined) shape.setAttribute("title", spec.title);
    if (spec.alignment !== undefined) {
      declarations.set("mso-position-horizontal", spec.alignment);
      declarations.set("mso-position-horizontal-relative", "column");
    }
    if (spec.wrap !== undefined) {
      for (const wrap of descendants(shape, W10, "wrap")) wrap.remove();
      if (spec.wrap === "inline") {
        declarations.delete("position");
        declarations.delete("z-index");
      } else {
        declarations.set("position", "absolute");
        declarations.set("z-index", spec.wrap === "behind" ? "-1" : "1");
        const wrap = make(doc, W10, "w10:wrap");
        wrap.setAttributeNS(
          W10,
          "w10:type",
          spec.wrap === "square"
            ? "square"
            : spec.wrap === "top-bottom"
              ? "topAndBottom"
              : "none",
        );
        shape.append(wrap);
      }
    }
    shape.setAttribute(
      "style",
      Array.from(declarations, ([key, value]) => `${key}:${value}`).join(";"),
    );
    return;
  }
  const extent = child(container, WP, "extent")!;
  const oldWidth = Number(extent.getAttribute("cx")) || EMU * 216,
    oldHeight = Number(extent.getAttribute("cy")) || EMU * 144;
  const width =
    spec.widthPt === undefined
      ? spec.heightPt === undefined
        ? oldWidth
        : Math.round((spec.heightPt * EMU * oldWidth) / oldHeight)
      : Math.round(spec.widthPt * EMU);
  const height =
    spec.heightPt === undefined
      ? spec.widthPt === undefined
        ? oldHeight
        : Math.round((spec.widthPt * EMU * oldHeight) / oldWidth)
      : Math.round(spec.heightPt * EMU);
  extent.setAttribute("cx", String(width));
  extent.setAttribute("cy", String(height));
  const xfrm = descendants(drawing, A, "xfrm").find(
    (e) => mediaOwner(e) === drawing,
  );
  if (xfrm) {
    const size = child(xfrm, A, "ext");
    if (size) {
      size.setAttribute("cx", String(width));
      size.setAttribute("cy", String(height));
    }
    if (spec.rotation !== undefined)
      xfrm.setAttribute("rot", String(Math.round(spec.rotation * 60000)));
  }
  const properties = child(container, WP, "docPr");
  if (properties) {
    if (!preserveIds)
      properties.setAttribute("id", allocateWordNativeId(doc, "drawing"));
    if (spec.alt !== undefined) {
      if (spec.alt) properties.setAttribute("descr", spec.alt);
      else properties.removeAttribute("descr");
    }
    if (spec.title !== undefined) {
      if (spec.title) properties.setAttribute("title", spec.title);
      else properties.removeAttribute("title");
      properties.setAttribute("name", spec.title);
    }
  }
  if (container.localName === "anchor" && spec.alignment !== undefined) {
    const horizontal = child(container, WP, "positionH");
    if (horizontal) {
      horizontal.setAttribute("relativeFrom", "column");
      const value = make(doc, WP, "wp:align");
      value.textContent = spec.alignment;
      horizontal.replaceChildren(value);
    }
  }
  if (spec.wrap !== undefined) {
    const current = container;
    container = make(
      doc,
      WP,
      spec.wrap === "inline" ? "wp:inline" : "wp:anchor",
      {
        distT: current.getAttribute("distT") ?? 0,
        distB: current.getAttribute("distB") ?? 0,
        distL: current.getAttribute("distL") ?? 0,
        distR: current.getAttribute("distR") ?? 0,
      },
    );
    for (const attribute of Array.from(current.attributes)) {
      if (attribute.namespaceURI)
        container.setAttributeNS(
          attribute.namespaceURI,
          attribute.name,
          attribute.value,
        );
    }
    if (spec.wrap !== "inline") {
      for (const [key, value] of Object.entries({
        simplePos: current.getAttribute("simplePos") ?? "0",
        relativeHeight: current.getAttribute("relativeHeight") ?? "0",
        behindDoc: spec.wrap === "behind" ? "1" : "0",
        locked: current.getAttribute("locked") ?? "0",
        layoutInCell: current.getAttribute("layoutInCell") ?? "1",
        allowOverlap: current.getAttribute("allowOverlap") ?? "1",
      }))
        container.setAttribute(key, value);
      container.append(
        child(current, WP, "simplePos") ??
          make(doc, WP, "wp:simplePos", { x: 0, y: 0 }),
      );
      const horizontal = make(doc, WP, "wp:positionH", {
          relativeFrom: "column",
        }),
        vertical = make(doc, WP, "wp:positionV", { relativeFrom: "paragraph" });
      const alignment = make(doc, WP, "wp:align");
      alignment.textContent = spec.alignment ?? "left";
      horizontal.append(alignment);
      const offset = make(doc, WP, "wp:posOffset");
      offset.textContent = "0";
      vertical.append(offset);
      container.append(
        child(current, WP, "positionH") ?? horizontal,
        child(current, WP, "positionV") ?? vertical,
      );
    }
    for (const name of ["extent", "effectExtent"]) {
      const item = child(current, WP, name);
      if (item) container.append(item);
    }
    if (spec.wrap !== "inline")
      container.append(
        make(
          doc,
          WP,
          spec.wrap === "square"
            ? "wp:wrapSquare"
            : spec.wrap === "top-bottom"
              ? "wp:wrapTopAndBottom"
              : "wp:wrapNone",
          spec.wrap === "square" ? { wrapText: "bothSides" } : {},
        ),
      );
    for (const name of ["docPr", "cNvGraphicFramePr"]) {
      const item = child(current, WP, name);
      if (item) container.append(item);
    }
    const graphic = child(current, A, "graphic");
    if (graphic) container.append(graphic);
    if (spec.wrap !== "inline") {
      for (const extra of Array.from(current.children)) {
        if (extra.namespaceURI !== WP && extra.namespaceURI !== A)
          container.append(extra);
      }
    }
    current.replaceWith(container);
  }
}

function sourceDrawing(
  doc: Document,
  source: WordMediaSource,
  kind: "image" | "drawing",
  index: number,
) {
  if (!source.sourceXml)
    throw new Error("The referenced media was not captured");
  const nodes = mediaNodes(parseFragment(source.sourceXml)).filter(
    (n) => isImage(n) === (kind === "image"),
  );
  const original = nodes[index];
  if (!original) throw new Error("The referenced media no longer exists");
  const node = doc.importNode(original, true);
  // Copies of shapes can contain other images in a text box; all non-visual IDs
  // need fresh identities, while inner geometry stays untouched.
  if (!source.preserveIds)
    for (const properties of descendants(node, WP, "docPr"))
      properties.setAttribute("id", allocateWordNativeId(doc, "drawing"));
  if (!legacyIds.has(doc)) reserveWordNativeIds(doc);
  const existing = legacyIds.get(doc)!;
  if (!source.preserveIds)
    for (const shape of Array.from(node.getElementsByTagNameNS(VML, "*"))) {
      if (!shape.hasAttribute("id") || shape.localName === "shapetype")
        continue;
      let counter = 1;
      while (existing.has(`erato_shape_${counter}`)) counter++;
      const identifier = `erato_shape_${counter}`;
      existing.add(identifier);
      shape.setAttribute("id", identifier);
      if (
        shape.hasAttributeNS("urn:schemas-microsoft-com:office:office", "spid")
      )
        shape.removeAttributeNS(
          "urn:schemas-microsoft-com:office:office",
          "spid",
        );
    }
  rebindWordMediaRelationships(
    doc,
    node,
    source.sourcePart ?? "/word/document.xml",
    source.storyPart ?? "/word/document.xml",
  );
  return node;
}

/** Read existing embedded raster bytes for the review; never fetch linked images. */
export function readWordImageData(
  doc: Document,
  sourceXml: string,
  sourceIndex = 0,
  sourcePart = "/word/document.xml",
): WordImageSpec["data"] | undefined {
  const picture = mediaNodes(parseFragment(sourceXml)).filter(isImage)[
    sourceIndex
  ];
  if (!picture) return undefined;
  const embedded =
    descendants(picture, A, "blip")[0]?.getAttributeNS(R, "embed") ??
    descendants(
      picture,
      "urn:schemas-microsoft-com:vml",
      "imagedata",
    )[0]?.getAttributeNS(R, "id");
  if (!embedded) return undefined;
  const relPart = packagePart(doc, relationshipPath(sourcePart));
  const rel = relPart
    ? descendants(relPart, REL, "Relationship").find(
        (r) => r.getAttribute("Id") === embedded,
      )
    : undefined;
  if (!rel || rel.getAttribute("TargetMode") === "External") return undefined;
  const part = packagePart(
    doc,
    absoluteTarget(sourcePart, rel.getAttribute("Target") ?? ""),
  );
  if (!part) return undefined;
  const value = {
    mime: part.getAttributeNS(PKG, "contentType"),
    base64:
      descendants(part, PKG, "binaryData")[0]?.textContent?.replace(
        /\s/g,
        "",
      ) ?? "",
  };
  return imageData(value) ? value : undefined;
}
function paragraph(doc: Document, drawing: Element, alignment?: string) {
  const p = make(doc, W, "w:p"),
    run = make(doc, W, "w:r");
  if (alignment) {
    const properties = make(doc, W, "w:pPr"),
      jc = make(doc, W, "w:jc");
    jc.setAttributeNS(W, "w:val", alignment);
    properties.append(jc);
    p.append(properties);
  }
  const runProperties = make(doc, W, "w:rPr");
  runProperties.append(make(doc, W, "w:noProof"));
  run.append(runProperties, drawing);
  p.append(run);
  return p;
}

export function compileWordImage(
  doc: Document,
  spec: WordImageSpec,
  source: WordMediaSource = {},
): Element {
  if (!isWordImageSpec(spec)) throw new Error("Invalid image specification");
  if (spec.assetRef)
    throw new Error("Resolve the captured image asset before compilation");
  const drawing = spec.sourceRef
    ? sourceDrawing(doc, source, "image", spec.sourceIndex ?? 0)
    : picture(
        doc,
        addImage(doc, spec.data!, source.storyPart ?? "/word/document.xml"),
        spec,
      );
  if (spec.sourceRef && spec.data) {
    const blips = descendants(drawing, A, "blip");
    const vmlImages = descendants(
      drawing,
      "urn:schemas-microsoft-com:vml",
      "imagedata",
    );
    const relationshipId = addImage(
      doc,
      spec.data,
      source.storyPart ?? "/word/document.xml",
    );
    for (const blip of blips) {
      blip.removeAttributeNS(R, "link");
      blip.setAttributeNS(R, "r:embed", relationshipId);
    }
    for (const image of vmlImages)
      image.setAttributeNS(R, "r:id", relationshipId);
    if (!blips.length && !vmlImages.length)
      throw new Error("No image reference to replace");
  }
  updateFrame(doc, drawing, spec, source.preserveIds);
  if (spec.crop) {
    const fill = descendants(drawing, PIC, "blipFill")[0];
    const legacy = descendants(drawing, VML, "imagedata")[0];
    if (!fill && !legacy) throw new Error("This image does not support crop");
    if (legacy && !fill)
      for (const [side, fraction] of Object.entries(spec.crop))
        legacy.setAttribute(`crop${side}`, String(fraction / 100));
    if (fill) {
      child(fill, A, "srcRect")?.remove();
      const rectangle = make(
        doc,
        A,
        "a:srcRect",
        Object.fromEntries(
          Object.entries(spec.crop).map(([name, n]) => [
            name[0],
            Math.round(n * 1000),
          ]),
        ),
      );
      fill.insertBefore(
        rectangle,
        child(fill, A, "stretch") ?? child(fill, A, "tile") ?? null,
      );
    }
  }
  if (spec.border) {
    const shape = descendants(drawing, PIC, "spPr")[0];
    const legacy = legacyShape(drawing);
    if (!shape && !legacy)
      throw new Error("This image does not support borders");
    if (legacy && !shape) applyLegacyLine(legacy, spec.border);
    if (shape) {
      const line = make(doc, A, "a:ln", {
        w: Math.round(spec.border.widthPt * EMU),
      });
      line.append(colorElement(doc, spec.border.color));
      replaceShapeProperty(shape, ["ln"], line, [
        "effectLst",
        "effectDag",
        "scene3d",
        "sp3d",
        "extLst",
      ]);
    }
  }
  return paragraph(doc, drawing, spec.alignment);
}

function applyLegacyLine(
  shape: Element,
  line: NonNullable<WordImageSpec["border"]>,
) {
  shape.setAttribute(
    "stroked",
    line.color === "none" || line.widthPt === 0 ? "f" : "t",
  );
  shape.setAttribute("strokeweight", `${line.widthPt}pt`);
  if (line.color !== "none")
    shape.setAttribute("strokecolor", `#${line.color.toUpperCase()}`);
  for (const stroke of descendants(shape, VML, "stroke")) {
    stroke.setAttribute("on", shape.getAttribute("stroked")!);
    stroke.setAttribute("weight", `${line.widthPt}pt`);
    if (line.color !== "none")
      stroke.setAttribute("color", `#${line.color.toUpperCase()}`);
  }
}

export function compileWordDrawing(
  doc: Document,
  spec: WordDrawingSpec,
  source: WordMediaSource = {},
): Element {
  if (!isWordDrawingSpec(spec))
    throw new Error("Invalid drawing specification");
  let drawing: Element;
  if (spec.sourceRef)
    drawing = sourceDrawing(doc, source, "drawing", spec.sourceIndex ?? 0);
  else {
    drawing = make(doc, W, "w:drawing");
    const inline = frame(
      doc,
      spec.widthPt ?? 216,
      spec.heightPt ?? 72,
      spec.title ?? "",
      spec.alt ?? "",
    );
    const graphic = make(doc, A, "a:graphic"),
      data = make(doc, A, "a:graphicData", { uri: WPS }),
      shape = make(doc, WPS, "wps:wsp");
    const nonVisual = make(doc, WPS, "wps:cNvSpPr", { txBox: 1 });
    nonVisual.append(make(doc, A, "a:spLocks", { noChangeAspect: 1 }));
    shape.append(nonVisual);
    const properties = make(doc, WPS, "wps:spPr");
    properties.append(transform(doc, spec.widthPt ?? 216, spec.heightPt ?? 72));
    shape.append(properties, make(doc, WPS, "wps:bodyPr"));
    data.append(shape);
    graphic.append(data);
    inline.append(graphic);
    drawing.append(inline);
  }
  updateFrame(doc, drawing, spec, source.preserveIds);
  const legacy = legacyShape(drawing);
  if (legacy) {
    if (spec.shape) {
      const original = inventoryWordMedia(drawing, "source")[0];
      return compileWordDrawing(
        doc,
        {
          ...spec,
          sourceRef: undefined,
          sourceIndex: undefined,
          widthPt: spec.widthPt ?? original?.widthPt,
          heightPt: spec.heightPt ?? original?.heightPt,
          text: spec.text ?? original?.text,
        },
        {},
      );
    }
    if (spec.fill !== undefined) {
      legacy.setAttribute("filled", spec.fill === "none" ? "f" : "t");
      if (spec.fill !== "none")
        legacy.setAttribute("fillcolor", `#${spec.fill.toUpperCase()}`);
      for (const fill of descendants(legacy, VML, "fill")) {
        fill.setAttribute("on", spec.fill === "none" ? "f" : "t");
        fill.setAttribute("type", "solid");
        if (spec.fill !== "none")
          fill.setAttribute("color", `#${spec.fill.toUpperCase()}`);
      }
    }
    if (spec.line) applyLegacyLine(legacy, spec.line);
    if (spec.text !== undefined) {
      let textbox = descendants(legacy, VML, "textbox")[0];
      if (!textbox) {
        textbox = make(doc, VML, "v:textbox");
        legacy.append(textbox);
      }
      const contents = make(doc, W, "w:txbxContent");
      for (const line of spec.text.split(/\r?\n/)) {
        const p = make(doc, W, "w:p"),
          r = make(doc, W, "w:r"),
          t = make(doc, W, "w:t");
        t.setAttributeNS(
          "http://www.w3.org/XML/1998/namespace",
          "xml:space",
          "preserve",
        );
        t.textContent = line;
        r.append(t);
        p.append(r);
        contents.append(p);
      }
      textbox.replaceChildren(contents);
    }
    return paragraph(doc, drawing, spec.alignment);
  }
  const properties =
    descendants(drawing, WPS, "spPr")[0] ?? descendants(drawing, A, "spPr")[0];
  if (
    !properties &&
    [spec.shape, spec.fill, spec.line, spec.text].some((v) => v !== undefined)
  )
    throw new Error("This native drawing has no editable shape content");
  if (properties) {
    if (spec.shape) {
      const geometry = make(doc, A, "a:prstGeom", { prst: spec.shape });
      geometry.append(make(doc, A, "a:avLst"));
      replaceShapeProperty(properties, ["prstGeom", "custGeom"], geometry, [
        "noFill",
        "solidFill",
        "gradFill",
        "blipFill",
        "pattFill",
        "grpFill",
        "ln",
        "effectLst",
        "effectDag",
        "scene3d",
        "sp3d",
        "extLst",
      ]);
    }
    if (spec.fill !== undefined || !spec.sourceRef)
      replaceShapeProperty(
        properties,
        ["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"],
        colorElement(doc, spec.fill ?? "E8EEF7"),
        ["ln", "effectLst", "effectDag", "scene3d", "sp3d", "extLst"],
      );
    if (spec.line) {
      const line = make(doc, A, "a:ln", {
        w: Math.round(spec.line.widthPt * EMU),
      });
      line.append(colorElement(doc, spec.line.color));
      replaceShapeProperty(properties, ["ln"], line, [
        "effectLst",
        "effectDag",
        "scene3d",
        "sp3d",
        "extLst",
      ]);
    }
    if (spec.text !== undefined) {
      const shape = properties.parentElement!;
      if (shape.namespaceURI !== WPS)
        throw new Error("This native drawing has no editable Word text box");
      child(shape, WPS, "txbx")?.remove();
      const textbox = make(doc, WPS, "wps:txbx"),
        contents = make(doc, W, "w:txbxContent");
      for (const line of spec.text.split(/\r?\n/)) {
        const p = make(doc, W, "w:p"),
          r = make(doc, W, "w:r"),
          t = make(doc, W, "w:t");
        t.setAttributeNS(
          "http://www.w3.org/XML/1998/namespace",
          "xml:space",
          "preserve",
        );
        t.textContent = line;
        r.append(t);
        p.append(r);
        contents.append(p);
      }
      textbox.append(contents);
      shape.insertBefore(textbox, child(shape, WPS, "bodyPr") ?? null);
    }
  }
  return paragraph(doc, drawing, spec.alignment);
}
