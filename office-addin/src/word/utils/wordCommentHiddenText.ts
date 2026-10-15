const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const HIDING = ["vanish", "specVanish", "webHidden"];
const OFF = ["0", "false", "off"];

const hides = (rPr: Element) =>
  Array.from(rPr.children).some(
    (child) =>
      child.namespaceURI === W &&
      HIDING.includes(child.localName) &&
      !OFF.includes(child.getAttributeNS(W, "val") ?? ""),
  );

const hiddenIn = (element: Element) =>
  Array.from(element.getElementsByTagNameNS(W, "rPr")).some(hides);

/**
 * Whether a paragraph's package holds hidden text: a hiding run property, its own or a style's.
 * A package that does not parse counts as hidden, so nothing is written on a guess.
 */
export function wordPackageHoldsHiddenText(ooxml: string): boolean {
  const doc = new DOMParser().parseFromString(ooxml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return true;
  const part = (name: string) =>
    Array.from(doc.getElementsByTagNameNS(PKG, "part")).find(
      (p) =>
        (p.getAttributeNS(PKG, "name") ?? p.getAttribute("pkg:name")) === name,
    ) ?? null;
  const body = part("/word/document.xml") ?? doc.documentElement;
  if (hiddenIn(body)) return true;
  const styles = part("/word/styles.xml");
  if (!styles) return false;
  const defaults = styles.getElementsByTagNameNS(W, "docDefaults")[0];
  if (defaults && hiddenIn(defaults)) return true;
  const all = Array.from(styles.getElementsByTagNameNS(W, "style"));
  const basedOn = new Map(
    all.map((style) => [
      style.getAttributeNS(W, "styleId") ?? "",
      style.getElementsByTagNameNS(W, "basedOn")[0]?.getAttributeNS(W, "val") ??
        null,
    ]),
  );
  const hiding = new Set(
    all
      .filter(hiddenIn)
      .map((style) => style.getAttributeNS(W, "styleId") ?? ""),
  );
  const hidingStyle = (id: string | null) => {
    for (let at = id, hops = 0; at !== null && hops < 32; hops += 1) {
      if (hiding.has(at)) return true;
      at = basedOn.get(at) ?? null;
    }
    return false;
  };
  return ["rStyle", "pStyle"].some((name) =>
    Array.from(body.getElementsByTagNameNS(W, name)).some((use) =>
      hidingStyle(use.getAttributeNS(W, "val")),
    ),
  );
}

/** Of these paragraphs, the indexes whose packages hold hidden text; one sync. */
async function hiddenParagraphs(
  context: Word.RequestContext,
  paragraphs: ReadonlyMap<number, Word.Paragraph>,
): Promise<Set<number>> {
  const packages = [...paragraphs].map(
    ([at, paragraph]) => [at, paragraph.getOoxml()] as const,
  );
  if (packages.length) await context.sync();
  return new Set(
    packages
      .filter(([, ooxml]) => wordPackageHoldsHiddenText(ooxml.value))
      .map(([at]) => at),
  );
}

const span = (first: number, last: number) =>
  Array.from({ length: last - first + 1 }, (_, k) => first + k);

/**
 * Of these new comments' anchors, given as story positions, the ones with hidden text in a
 * paragraph from their first to their last. Word for the web reads each package in about 0.45 s.
 */
export async function wordAnchorsBesideHiddenText(
  context: Word.RequestContext,
  items: readonly Word.Paragraph[],
  anchors: ReadonlyMap<number, readonly number[]>,
): Promise<Set<number>> {
  const wanted = new Map<number, Word.Paragraph>();
  for (const positions of anchors.values())
    for (const at of span(Math.min(...positions), Math.max(...positions)))
      wanted.set(at, items[at]);
  const hidden = await hiddenParagraphs(context, wanted);
  return new Set(
    [...anchors]
      .filter(([, positions]) =>
        span(Math.min(...positions), Math.max(...positions)).some((at) =>
          hidden.has(at),
        ),
      )
      .map(([key]) => key),
  );
}

/**
 * Of these threads (String(Comment.id)), the ones whose paragraphs hold hidden text, and the ones
 * no paragraph lists, which cannot be checked. Paragraph.getComments names a thread in the
 * paragraph its anchor starts in and the one it ends in (ERMAIN-983); the ones between count too.
 */
export async function wordThreadsBesideHiddenText(
  context: Word.RequestContext,
  ids: readonly string[],
): Promise<Set<string>> {
  const wanted = new Set(ids);
  if (!wanted.size) return new Set();
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load("items/tableNestingLevel");
  await context.sync();
  const lists = paragraphs.items.map((paragraph) => {
    const list = paragraph.getComments();
    list.load("items/id");
    return list;
  });
  await context.sync();
  const spans = new Map<string, [number, number]>();
  lists.forEach((list, at) => {
    for (const comment of list.items) {
      const id = String(comment.id);
      if (!wanted.has(id)) continue;
      const known = spans.get(id);
      spans.set(id, known ? [known[0], at] : [at, at]);
    }
  });
  const needed = new Map<number, Word.Paragraph>();
  for (const [first, last] of spans.values())
    for (const at of span(first, last)) needed.set(at, paragraphs.items[at]);
  const hidden = await hiddenParagraphs(context, needed);
  return new Set(
    [...wanted].filter((id) => {
      const known = spans.get(id);
      return !known || span(...known).some((at) => hidden.has(at));
    }),
  );
}
