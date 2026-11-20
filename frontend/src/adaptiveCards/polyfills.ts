/**
 * What the card components and React need from a browser, for an engine that
 * has none of it (the backend's embedded QuickJS). Timers queue until
 * `drainTimers` runs them; `Intl` covers plurals and numbers in the card
 * languages. Imported first, so `scheduler` captures these timers.
 */

type Timer = { id: number; run: () => void };

const timers: Timer[] = [];
let nextTimer = 1;

const scope = globalThis as Record<string, unknown>;

if (typeof scope.setTimeout !== "function") {
  scope.setTimeout = (
    run: (...args: unknown[]) => void,
    _ms?: number,
    ...args: unknown[]
  ) => {
    const id = nextTimer++;
    timers.push({ id, run: () => run(...args) });
    return id;
  };
  scope.clearTimeout = (id: number) => {
    const index = timers.findIndex((timer) => timer.id === id);
    if (index >= 0) timers.splice(index, 1);
  };
}

/** Runs queued timers, and those they queue, up to `limit` of them. */
export const drainTimers = (limit = 1_000) => {
  for (let ran = 0; timers.length > 0 && ran < limit; ran++) {
    timers.shift()?.run();
  }
};

if (typeof scope.window === "undefined") scope.window = globalThis;
if (typeof scope.self === "undefined") scope.self = globalThis;
if (typeof scope.performance === "undefined") {
  scope.performance = { now: () => Date.now() };
}
if (typeof scope.console === "undefined") {
  const quiet = () => undefined;
  scope.console = {
    log: quiet,
    info: quiet,
    warn: quiet,
    error: quiet,
    debug: quiet,
  };
}
const memoryStorage = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, String(value)),
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
    key: (index: number) => [...items.keys()][index] ?? null,
    get length() {
      return items.size;
    },
  };
};
if (typeof scope.localStorage === "undefined")
  scope.localStorage = memoryStorage();
if (typeof scope.sessionStorage === "undefined")
  scope.sessionStorage = memoryStorage();
if (typeof scope.navigator === "undefined") {
  scope.navigator = {
    userAgent: "erato-adaptive-cards",
    language: "en",
    languages: ["en"],
  };
}
if (typeof scope.ResizeObserver === "undefined") {
  scope.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

type Plural = "zero" | "one" | "two" | "few" | "many" | "other";

const base = (locales: unknown): string => {
  const first = Array.isArray(locales) ? locales[0] : locales;
  return typeof first === "string"
    ? first.toLowerCase().split(/[-_]/)[0]
    : "en";
};

/** CLDR cardinal rules for the card languages; integers and plain decimals. */
const cardinal = (language: string, n: number): Plural => {
  const integer = Number.isInteger(n);
  const i = Math.floor(Math.abs(n));
  switch (language) {
    case "fr":
      return i === 0 || i === 1
        ? "one"
        : integer && i !== 0 && i % 1_000_000 === 0
          ? "many"
          : "other";
    case "es":
      return n === 1
        ? "one"
        : integer && i !== 0 && i % 1_000_000 === 0
          ? "many"
          : "other";
    case "pl": {
      if (!integer) return "other";
      if (i === 1) return "one";
      const ten = i % 10;
      const hundred = i % 100;
      if (ten >= 2 && ten <= 4 && !(hundred >= 12 && hundred <= 14))
        return "few";
      return "many";
    }
    default:
      return integer && i === 1 ? "one" : "other";
  }
};

const ordinal = (language: string, n: number): Plural => {
  if (language !== "en") return "other";
  const ten = n % 10;
  const hundred = n % 100;
  if (ten === 1 && hundred !== 11) return "one";
  if (ten === 2 && hundred !== 12) return "two";
  if (ten === 3 && hundred !== 13) return "few";
  return "other";
};

/** Separators and the digits a number needs before it is grouped, per CLDR. */
const NUMBER_STYLE: Record<
  string,
  { group: string; decimal: string; minGrouping: number }
> = {
  en: { group: ",", decimal: ".", minGrouping: 1 },
  de: { group: ".", decimal: ",", minGrouping: 1 },
  fr: { group: "\u202f", decimal: ",", minGrouping: 1 },
  es: { group: ".", decimal: ",", minGrouping: 2 },
  pl: { group: "\u00a0", decimal: ",", minGrouping: 2 },
};

export const formatNumber = (language: string, value: number): string => {
  if (!Number.isFinite(value)) return String(value);
  const style = NUMBER_STYLE[language] ?? NUMBER_STYLE.en;
  const [whole, fraction] = Math.abs(value)
    .toFixed(Number.isInteger(value) ? 0 : 3)
    .replace(/0+$/, "")
    .replace(/\.$/, "")
    .split(".");
  const grouped =
    whole.length > 3 + style.minGrouping - 1
      ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, style.group)
      : whole;
  return `${value < 0 ? "-" : ""}${grouped}${fraction ? style.decimal + fraction : ""}`;
};

/** The language `toLocaleString` formats in; the card sets it per render. */
let activeLanguage = "en";
export const setNumberLanguage = (locale: string) => {
  activeLanguage = base(locale);
};

const intl = (scope.Intl ?? {}) as Record<string, unknown>;
if (typeof intl.PluralRules !== "function") {
  intl.PluralRules = class {
    private readonly language: string;
    private readonly type: string;
    constructor(locales?: unknown, options?: { type?: string }) {
      this.language = base(locales);
      this.type = options?.type ?? "cardinal";
    }
    select(n: number): Plural {
      return this.type === "ordinal"
        ? ordinal(this.language, n)
        : cardinal(this.language, n);
    }
  };
}
if (typeof intl.NumberFormat !== "function") {
  intl.NumberFormat = class {
    private readonly language: string;
    constructor(locales?: unknown) {
      this.language = base(locales);
    }
    format(value: number): string {
      return formatNumber(this.language, value);
    }
  };
  Number.prototype.toLocaleString = function toLocaleString(this: number) {
    return formatNumber(activeLanguage, Number(this));
  };
}
scope.Intl = intl;
