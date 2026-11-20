/* eslint-disable lingui/no-unlocalized-strings -- Adaptive Card schema values and the web's class names, not text for readers */
import type { HostElement, HostNode, RenderedTree } from "./hostTree";

/**
 * Turns a card the web rendered into Adaptive Card elements. The web's own
 * markup decides what is said and in which order; this reads its structure
 * (blocks, rows, disclosures, links) and its text classes (weight, colour,
 * strike-through). Text only ever goes into `TextRun`s, which Teams does not
 * read as Markdown, so server text cannot make links or formatting.
 */

export type AcElement = Record<string, unknown>;

interface TextRun {
  type: "TextRun";
  text: string;
  weight?: "Bolder";
  isSubtle?: boolean;
  size?: "Small" | "Medium" | "Large";
  strikethrough?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontType?: "Monospace";
  color?: "Accent" | "Good" | "Warning" | "Attention";
}

interface Style {
  bold: boolean;
  subtle: boolean;
  size?: TextRun["size"];
  strike: boolean;
  italic: boolean;
  underline: boolean;
  mono: boolean;
  color?: TextRun["color"];
  /** Keep line breaks and runs of spaces, as `whitespace-pre*` does. */
  pre: boolean;
  indent: number;
  /** Items of a list the web marks with bullets. */
  bullets: boolean;
}

const PLAIN: Style = {
  bold: false,
  subtle: false,
  strike: false,
  italic: false,
  underline: false,
  mono: false,
  pre: false,
  indent: 0,
  bullets: false,
};

/** Quotation marks a browser draws around `<q>` in each card language. */
const QUOTES: Record<string, [string, string]> = {
  en: ["\u201c", "\u201d"],
  de: ["\u201e", "\u201c"],
  fr: ["\u00ab\u00a0", "\u00a0\u00bb"],
  es: ["\u00ab", "\u00bb"],
  pl: ["\u201e", "\u201d"],
};

const BLOCK_TYPES = new Set([
  "div",
  "p",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "nav",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "blockquote",
  "table",
  "tr",
  "td",
  "th",
  "figure",
  "figcaption",
  "form",
  "fieldset",
  "legend",
]);

const SKIPPED_TYPES = new Set([
  "svg",
  "img",
  "input",
  "textarea",
  "select",
  "script",
  "style",
]);

const classesOf = (element: HostElement): Set<string> => {
  const value = element.props.className;
  return new Set(
    typeof value === "string" ? value.split(/\s+/).filter(Boolean) : [],
  );
};

/**
 * What a sighted reader does not see. `aria-hidden` text, such as the arrow
 * between an old and a new value, is on screen, so it stays.
 */
const isHidden = (element: HostElement, classes: Set<string>): boolean => {
  const style = element.props.style as Record<string, unknown> | undefined;
  return (
    SKIPPED_TYPES.has(element.type) ||
    element.props.hidden === true ||
    classes.has("sr-only") ||
    classes.has("hidden") ||
    style?.display === "none" ||
    // A closed `Collapse`: in the page it takes no room.
    style?.gridTemplateRows === "0fr"
  );
};

const isBlock = (element: HostElement, classes: Set<string>): boolean =>
  BLOCK_TYPES.has(element.type) ||
  classes.has("block") ||
  classes.has("flex") ||
  classes.has("grid");

const styleOf = (style: Style, classes: Set<string>): Style => {
  const next = { ...style };
  for (const name of classes) {
    if (
      name === "font-semibold" ||
      name === "font-bold" ||
      name === "font-medium"
    )
      next.bold = true;
    else if (name === "font-normal") next.bold = false;
    else if (
      name === "text-theme-fg-muted" ||
      name === "text-theme-fg-secondary" ||
      name === "opacity-75"
    )
      next.subtle = true;
    else if (name === "text-theme-fg-primary") {
      next.subtle = false;
      next.color = undefined;
    } else if (name === "text-xs") next.size = "Small";
    else if (name === "text-sm") next.size = undefined;
    else if (name === "text-lg" || name === "text-xl" || name === "text-2xl")
      next.size = "Large";
    else if (name === "line-through") next.strike = true;
    else if (name === "italic") next.italic = true;
    else if (name === "underline") next.underline = true;
    else if (name === "font-mono") next.mono = true;
    else if (name.startsWith("whitespace-pre")) next.pre = true;
    else if (name === "whitespace-normal") next.pre = false;
    else if (name === "ml-4") next.indent = style.indent + 1;
    else if (name === "list-disc") next.bullets = true;
    else if (name === "list-none") next.bullets = false;
    else if (
      name === "text-theme-error-fg" ||
      name === "text-[var(--theme-diff-removed-fg)]"
    )
      next.color = "Attention";
    else if (
      name === "text-theme-success-fg" ||
      name === "text-[var(--theme-diff-added-fg)]"
    )
      next.color = "Good";
    else if (name === "text-theme-warning-fg") next.color = "Warning";
    else if (name === "text-theme-info-fg" || name === "text-theme-fg-accent")
      next.color = "Accent";
  }
  // The card's headline: one size above its rows, as on the web.
  if (classes.has("text-base") && next.bold) next.size = "Medium";
  return next;
};

/** A tinted block on the web becomes a container in the matching Teams style. */
const containerStyleOf = (classes: Set<string>): string | undefined => {
  if (classes.has("bg-theme-warning-bg")) return "warning";
  if (classes.has("bg-theme-error-bg")) return "attention";
  if (classes.has("bg-theme-info-bg")) return "accent";
  return undefined;
};

type Spacing = "None" | "Small" | "Default" | "Medium";

const SPACING_RANK: Record<Spacing, number> = {
  None: 0,
  Small: 1,
  Default: 2,
  Medium: 3,
};

/** The gap the web puts between a container's children. */
const childSpacingOf = (classes: Set<string>): Spacing | undefined => {
  for (const name of classes) {
    const match = /^space-y-(\S+)$/.exec(name);
    if (!match) continue;
    const step = Number(match[1]);
    if (!Number.isFinite(step) || step <= 0) return undefined;
    if (step <= 1) return "Small";
    if (step <= 2) return "Default";
    return "Medium";
  }
  return undefined;
};

/** The gap the web puts above an element of its own. */
const ownSpacingOf = (classes: Set<string>): Spacing | undefined => {
  for (const name of classes) {
    const match = /^(?:mt|pt)-(\S+)$/.exec(name);
    if (!match) continue;
    const step = Number(match[1]);
    if (!Number.isFinite(step) || step <= 0) continue;
    return step <= 1 ? "Small" : step <= 2 ? "Default" : "Medium";
  }
  return undefined;
};

const wider = (
  a: Spacing | undefined,
  b: Spacing | undefined,
): Spacing | undefined =>
  a === undefined
    ? b
    : b === undefined
      ? a
      : SPACING_RANK[a] >= SPACING_RANK[b]
        ? a
        : b;

const POSITIVE_STEP = /^(?:-?)(\d+(?:\.\d+)?|px)$/;

/** Horizontal room the web leaves on one side of an inline element. */
const roomOf = (classes: Set<string>, side: "start" | "end"): boolean => {
  const prefixes =
    side === "start"
      ? ["pl-", "ml-", "px-", "mx-", "ps-", "ms-"]
      : ["pr-", "mr-", "px-", "mx-", "pe-", "me-"];
  for (const name of classes) {
    const prefix = prefixes.find((candidate) => name.startsWith(candidate));
    if (!prefix) continue;
    const step = name.slice(prefix.length);
    if (POSITIVE_STEP.test(step) && step !== "0") return true;
  }
  return false;
};

/** Whether a flex row puts room between its children. */
const gapsChildren = (classes: Set<string>): boolean =>
  [...classes].some((name) => /^gap(?:-x)?-(?!0$)\S+$/.test(name));

const runOf = (text: string, style: Style): TextRun => {
  const run: TextRun = { type: "TextRun", text };
  if (style.bold) run.weight = "Bolder";
  if (style.subtle) run.isSubtle = true;
  if (style.size) run.size = style.size;
  if (style.strike) run.strikethrough = true;
  if (style.italic) run.italic = true;
  if (style.underline) run.underline = true;
  if (style.mono) run.fontType = "Monospace";
  if (style.color) run.color = style.color;
  return run;
};

const sameLook = (a: TextRun, b: TextRun) => {
  const { text: _a, ...lookA } = a;
  const { text: _b, ...lookB } = b;
  return JSON.stringify(lookA) === JSON.stringify(lookB);
};

const isHttps = (href: unknown): href is string => {
  if (typeof href !== "string") return false;
  try {
    const url = new URL(href);
    return (
      url.protocol === "https:" && url.username === "" && url.password === ""
    );
  } catch {
    return false;
  }
};

export interface MapOptions {
  locale: string;
  /** Prefixes every element id, so several cards' parts can share one card. */
  idPrefix: string;
}

/** Collects one block list: a paragraph being written, and the blocks done. */
class Blocks {
  readonly items: AcElement[] = [];
  private runs: TextRun[] = [];
  private indent = 0;
  /** The gap the next block gets from the one before it. */
  spacing: Spacing | undefined;

  text(raw: string, style: Style) {
    const last = this.runs.at(-1);
    const text =
      !style.pre && (last === undefined || /\s$/.test(last.text))
        ? raw.replace(/^\s+/, "")
        : raw;
    if (text.length === 0) return;
    if (this.runs.length === 0) this.indent = style.indent;
    const run = runOf(text, style);
    if (last && sameLook(last, run)) last.text += text;
    else this.runs.push(run);
  }

  hasText() {
    return this.runs.some((run) => run.text.trim().length > 0);
  }

  /** A space, where the web leaves room, unless the line already has one. */
  space(style: Style) {
    const last = this.runs.at(-1);
    if (!last || /\s$/.test(last.text)) return;
    this.text(" ", style);
  }

  flush() {
    if (!this.hasText()) {
      this.runs = [];
      return;
    }
    const runs = this.runs;
    this.runs = [];
    runs[0].text = runs[0].text.replace(/^[ \t]+/, "");
    const last = runs[runs.length - 1];
    last.text = last.text.replace(/[ \t]+$/, "");
    if (this.indent > 0) {
      runs[0].text = "\u00a0\u00a0".repeat(this.indent) + runs[0].text;
    }
    this.push({
      type: "RichTextBlock",
      inlines: runs.filter((run) => run.text.length > 0),
    });
  }

  push(element: AcElement) {
    this.flushIfWriting(element);
    if (this.items.length > 0) element.spacing = this.spacing ?? "None";
    this.spacing = undefined;
    this.items.push(element);
  }

  private flushIfWriting(element: AcElement) {
    if (element.type !== "RichTextBlock" && this.runs.length > 0) this.flush();
  }

  gap(spacing: Spacing | undefined) {
    this.spacing = wider(this.spacing, spacing);
  }
}

class Mapper {
  private ids = 0;
  private readonly regionIds = new Map<string, string>();

  constructor(
    private readonly tree: RenderedTree,
    private readonly options: MapOptions,
  ) {}

  map(nodes: HostNode[]): AcElement[] {
    const blocks = new Blocks();
    this.walk(nodes, PLAIN, blocks);
    blocks.flush();
    return blocks.items;
  }

  private nextId(kind: string) {
    this.ids += 1;
    return `${this.options.idPrefix}${kind}${this.ids}`;
  }

  /** The container of what a region shows while closed. */
  private closedId(region: string) {
    return `${this.regionId(region)}c`;
  }

  private regionId(region: string) {
    let id = this.regionIds.get(region);
    if (!id) {
      id = this.nextId("r");
      this.regionIds.set(region, id);
    }
    return id;
  }

  private walk(
    nodes: HostNode[],
    style: Style,
    blocks: Blocks,
    childGap?: Spacing,
    spaced = false,
  ) {
    nodes.forEach((node, index) => {
      if (index > 0 && childGap) blocks.gap(childGap);
      if (index > 0 && spaced) blocks.space(style);
      if (node.kind === "text") {
        const text = style.pre ? node.text : node.text.replace(/\s+/g, " ");
        blocks.text(text, style);
        return;
      }
      this.element(node, style, blocks);
    });
  }

  private element(element: HostElement, parentStyle: Style, blocks: Blocks) {
    const classes = classesOf(element);
    if (isHidden(element, classes)) return;
    const style = styleOf(parentStyle, classes);
    const region = element.props["aria-controls"];

    if (element.type === "button") {
      if (typeof region === "string") {
        // A disclosure this render did not open has nothing to show.
        if (this.tree.toggles.has(region)) this.toggle(region, style, blocks);
      } else if (element.props["aria-expanded"] !== undefined) {
        // A row whose title is its own toggle: the title is the content.
        this.block(element, style, classes, blocks);
      }
      return;
    }

    if (
      typeof element.props.id === "string" &&
      this.tree.toggles.has(element.props.id)
    ) {
      const toggle = this.tree.toggles.get(element.props.id);
      blocks.flush();
      // A region on screen while closed, such as a long text's first lines,
      // shows that part until the toggle swaps in the whole.
      if (toggle?.closed && textOf(toggle.closed).length > 0) {
        blocks.push({
          type: "Container",
          id: this.closedId(element.props.id),
          items: this.sub(toggle.closed, style, childSpacingOf(classes)),
        });
      }
      blocks.push({
        type: "Container",
        id: this.regionId(element.props.id),
        isVisible: false,
        items: this.sub(element.children, style, childSpacingOf(classes)),
      });
      return;
    }

    if (element.type === "a") {
      if (isHttps(element.props.href)) {
        const title = textOf(element.children);
        blocks.flush();
        blocks.push({
          type: "ActionSet",
          actions: [{ type: "Action.OpenUrl", title, url: element.props.href }],
        });
        return;
      }
      this.walk(element.children, style, blocks);
      return;
    }

    if (element.type === "q") {
      const [open, close] = QUOTES[this.options.locale] ?? QUOTES.en;
      blocks.text(open, style);
      this.walk(element.children, style, blocks);
      blocks.text(close, style);
      return;
    }

    if (element.type === "dl") {
      const pairs = definitionPairs(element);
      if (pairs) {
        blocks.flush();
        blocks.gap(ownSpacingOf(classes));
        pairs.forEach(([term, detail], index) => {
          if (index > 0) blocks.gap("Small");
          this.row(term, detail, style, blocks);
        });
        return;
      }
    }

    if (element.props["data-testid"] === "tool-call-change-row") {
      const parts = element.children.filter(
        (child): child is HostElement => child.kind === "element",
      );
      if (parts.length === 2 && element.children.length === 2) {
        const [name, value] = parts;
        blocks.flush();
        blocks.gap(ownSpacingOf(classes));
        this.row([name], [value], style, blocks);
        return;
      }
    }

    // Teams cannot clamp lines, so a clamped text that runs longer shows its
    // first lines and an ellipsis, as the web does until it is opened.
    const clamp = lineClampOf(classes);
    if (clamp !== undefined) {
      const lines = rawTextOf(element.children).split("\n");
      if (lines.length > clamp) {
        blocks.flush();
        blocks.gap(ownSpacingOf(classes));
        blocks.text(`${lines.slice(0, clamp).join("\n")}\u2026`, {
          ...style,
          pre: true,
        });
        blocks.flush();
        return;
      }
    }

    const tint = containerStyleOf(classes);
    if (tint && isBlock(element, classes)) {
      blocks.flush();
      blocks.gap(ownSpacingOf(classes));
      blocks.push({
        type: "Container",
        style: tint,
        items: this.sub(element.children, style, childSpacingOf(classes)),
      });
      return;
    }

    if (element.type === "li") {
      blocks.flush();
      blocks.gap(ownSpacingOf(classes));
      if (parentStyle.bullets) blocks.text("\u2022 ", style);
      this.walk(element.children, style, blocks, childSpacingOf(classes));
      blocks.flush();
      return;
    }

    if (isBlock(element, classes)) {
      this.block(element, style, classes, blocks);
      return;
    }
    // The room around an element is its parent's, so a struck-out value's
    // padding does not become a struck-out space.
    if (roomOf(classes, "start")) blocks.space(parentStyle);
    this.walk(
      element.children,
      style,
      blocks,
      childSpacingOf(classes),
      gapsChildren(classes),
    );
    if (roomOf(classes, "end")) blocks.space(parentStyle);
  }

  private block(
    element: HostElement,
    style: Style,
    classes: Set<string>,
    blocks: Blocks,
  ) {
    blocks.flush();
    blocks.gap(ownSpacingOf(classes));
    this.walk(
      element.children,
      style,
      blocks,
      childSpacingOf(classes),
      gapsChildren(classes),
    );
    blocks.flush();
  }

  private sub(
    nodes: HostNode[],
    style: Style,
    childGap?: Spacing,
  ): AcElement[] {
    const blocks = new Blocks();
    this.walk(nodes, style, blocks, childGap);
    blocks.flush();
    return blocks.items;
  }

  /** A name beside its value, as the web's rows and definition lists show them. */
  private row(
    name: HostNode[],
    value: HostNode[],
    style: Style,
    blocks: Blocks,
  ) {
    blocks.push({
      type: "ColumnSet",
      columns: [
        {
          type: "Column",
          width: 2,
          items: this.sub(name, { ...style, subtle: true }),
        },
        { type: "Column", width: 3, items: this.sub(value, style) },
      ],
    });
  }

  private toggle(region: string, style: Style, blocks: Blocks) {
    const toggle = this.tree.toggles.get(region);
    if (!toggle) return;
    const regionId = this.regionId(region);
    const hint = this.sub(toggle.hint, style);
    const hintId = hint.length > 0 ? this.nextId("h") : undefined;
    const closedId =
      toggle.closed && textOf(toggle.closed).length > 0
        ? this.closedId(region)
        : undefined;
    blocks.flush();
    blocks.push({
      type: "ActionSet",
      actions: [
        {
          type: "Action.ToggleVisibility",
          title: textOf(toggle.label),
          targetElements: [
            regionId,
            ...(closedId ? [closedId] : []),
            ...(hintId ? [hintId] : []),
          ],
        },
      ],
    });
    if (hintId) blocks.push({ type: "Container", id: hintId, items: hint });
  }
}

/** A list's terms and their details, side by side or wrapped one pair per row. */
const definitionPairs = (
  list: HostElement,
): [HostNode[], HostNode[]][] | undefined => {
  const items = list.children.flatMap((child) =>
    child.kind === "element" && child.type === "div"
      ? child.children.filter(
          (node): node is HostElement => node.kind === "element",
        )
      : child.kind === "element"
        ? [child]
        : [],
  );
  const pairs: [HostNode[], HostNode[]][] = [];
  if (items.length % 2 !== 0) return undefined;
  for (let index = 0; index < items.length; index += 2) {
    const term = items[index];
    const detail = items[index + 1];
    if (term.type !== "dt" || detail.type !== "dd") return undefined;
    pairs.push([term.children, detail.children]);
  }
  return pairs.length > 0 ? pairs : undefined;
};

const lineClampOf = (classes: Set<string>): number | undefined => {
  for (const name of classes) {
    const match = /^line-clamp-(\d+)$/.exec(name);
    if (match) return Number(match[1]);
  }
  return undefined;
};

/** The visible text of a few nodes as written, line breaks included. */
const rawTextOf = (nodes: HostNode[]): string =>
  nodes
    .map((node) => {
      if (node.kind === "text") return node.text;
      return isHidden(node, classesOf(node)) ? "" : rawTextOf(node.children);
    })
    .join("");

/** The visible text of a few nodes on one line, for button titles. */
export const textOf = (nodes: HostNode[]): string =>
  nodes
    .map((node) => {
      if (node.kind === "text") return node.text;
      const classes = classesOf(node);
      return isHidden(node, classes) ? "" : textOf(node.children);
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();

export const toAdaptiveElements = (
  tree: RenderedTree,
  options: MapOptions,
): AcElement[] => new Mapper(tree, options).map(tree.root);
