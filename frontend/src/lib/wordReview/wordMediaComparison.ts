/** Prefer DrawingML in AlternateContent; its VML fallback describes the same shape. */
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const XMLNS = "http://www.w3.org/2000/xmlns/";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const WP =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const WPS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";
const child = (node: Element, namespace: string, local: string) =>
  Array.from(node.children).find(
    (e) => e.namespaceURI === namespace && e.localName === local,
  );
const all = (root: Element | Document, namespace: string, local: string) =>
  Array.from(root.getElementsByTagNameNS(namespace, local));

function knownChoice(element: Element): Element | undefined {
  if (
    element.namespaceURI !== MC ||
    element.localName !== "AlternateContent" ||
    Array.from(element.attributes).some((a) => a.namespaceURI !== XMLNS)
  )
    return undefined;
  const children = Array.from(element.children);
  if (
    children.some(
      (e) =>
        e.namespaceURI !== MC || !["Choice", "Fallback"].includes(e.localName),
    )
  )
    return undefined;
  for (const choice of children) {
    if (choice.localName !== "Choice") continue;
    if (
      Array.from(choice.attributes).some(
        (a) =>
          a.namespaceURI !== XMLNS &&
          !(a.namespaceURI === null && a.localName === "Requires"),
      )
    )
      return undefined;
    const required = choice.getAttribute("Requires")?.trim().split(/\s+/);
    if (
      !required?.length ||
      required.some((prefix) => choice.lookupNamespaceURI(prefix) !== WPS)
    )
      return undefined;
    if (
      choice.children.length !== 1 ||
      choice.firstElementChild?.namespaceURI !== W ||
      choice.firstElementChild.localName !== "drawing" ||
      !all(choice, WPS, "wsp").length
    )
      return undefined;
    return choice;
  }
  return undefined;
}

export function effectiveWordMediaChildren(element: Element): Element[] {
  return Array.from((knownChoice(element) ?? element).children);
}

export function isWordMediaElementActive(element: Element): boolean {
  let ancestor = element.parentElement;
  while (ancestor) {
    const choice = knownChoice(ancestor);
    if (choice && !choice.contains(element)) return false;
    ancestor = ancestor.parentElement;
  }
  return true;
}

/** Requires contains namespace prefixes as values, so XMLSerializer cannot
 * infer their declarations when a node is detached from its document root. */
export function cloneWordMediaNode(element: Element): Element {
  const clone = element.cloneNode(true) as Element;
  const originals = [element, ...all(element, MC, "Choice")].filter(
    (e) => e.namespaceURI === MC && e.localName === "Choice",
  );
  const copies = [clone, ...all(clone, MC, "Choice")].filter(
    (e) => e.namespaceURI === MC && e.localName === "Choice",
  );
  originals.forEach((source, index) => {
    for (const prefix of source.getAttribute("Requires")?.trim().split(/\s+/) ??
      []) {
      const namespace = source.lookupNamespaceURI(prefix);
      if (namespace)
        copies[index].setAttributeNS(XMLNS, `xmlns:${prefix}`, namespace);
    }
  });
  return clone;
}

/** Mutating a complete selected drawing invalidates its generated fallback. */
export function wordMediaMutationContainer(drawing: Element): Element {
  const choice = drawing.parentElement;
  const alternate = choice?.parentElement;
  return alternate && knownChoice(alternate) === choice ? alternate : drawing;
}

/** Normalize known import differences on a clone; unknown properties remain exact. */
export function normalizeWordMediaForComparison(doc: Document): void {
  for (const alternate of all(doc, MC, "AlternateContent")) {
    const choice = knownChoice(alternate);
    if (choice) alternate.replaceWith(...Array.from(choice.childNodes));
  }
  // Word may omit zero crop offsets on import.
  for (const rectangle of all(doc, A, "srcRect")) {
    for (const edge of ["l", "t", "r", "b"])
      if (rectangle.getAttribute(edge) === "0") rectangle.removeAttribute(edge);
  }
  for (const container of [
    ...all(doc, WP, "inline"),
    ...all(doc, WP, "anchor"),
  ]) {
    const effect = child(container, WP, "effectExtent");
    if (
      effect &&
      !effect.children.length &&
      ["l", "t", "r", "b"].every((side) => effect.getAttribute(side) === "0") &&
      Array.from(effect.attributes).every(
        (a) =>
          a.namespaceURI === XMLNS ||
          (a.namespaceURI === null &&
            ["l", "t", "r", "b"].includes(a.localName)),
      )
    )
      effect.remove();
    const properties = child(container, WP, "docPr");
    if (properties)
      for (const attribute of ["descr", "title"])
        if (properties.getAttribute(attribute) === "")
          properties.removeAttribute(attribute);
    const frameProperties = child(container, WP, "cNvGraphicFramePr");
    const frameLock =
      frameProperties && child(frameProperties, A, "graphicFrameLocks");
    if (
      !frameLock ||
      !["1", "true"].includes(frameLock.getAttribute("noChangeAspect") ?? "")
    )
      continue;
    const graphic = child(container, A, "graphic");
    const data = graphic && child(graphic, A, "graphicData");
    const shape = data && child(data, WPS, "wsp");
    const shapeProperties = shape && child(shape, WPS, "cNvSpPr");
    const shapeLock = shapeProperties && child(shapeProperties, A, "spLocks");
    if (
      shapeLock &&
      !shapeLock.children.length &&
      ["1", "true"].includes(shapeLock.getAttribute("noChangeAspect") ?? "") &&
      Array.from(shapeLock.attributes).every(
        (a) =>
          a.namespaceURI === XMLNS ||
          (a.namespaceURI === null && a.localName === "noChangeAspect"),
      )
    )
      shapeLock.remove();
  }
  for (const run of all(doc, W, "r")) {
    const payload = Array.from(run.children).filter(
      (e) =>
        !(
          e.namespaceURI === W &&
          ["rPr", "lastRenderedPageBreak"].includes(e.localName)
        ),
    );
    if (
      !payload.length ||
      payload.some(
        (e) =>
          e.namespaceURI !== W || !["drawing", "pict"].includes(e.localName),
      )
    )
      continue;
    const props = child(run, W, "rPr"),
      proof = props && child(props, W, "noProof");
    if (
      proof &&
      !proof.children.length &&
      Array.from(proof.attributes).every(
        (a) =>
          a.namespaceURI === XMLNS ||
          (a.namespaceURI === W &&
            a.localName === "val" &&
            ["1", "true", "on"].includes(a.value)),
      )
    ) {
      proof.remove();
      if (
        props &&
        !props.children.length &&
        Array.from(props.attributes).every((a) => a.namespaceURI === XMLNS)
      )
        props.remove();
    }
  }
}
