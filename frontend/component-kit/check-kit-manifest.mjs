// Build-time guard for COMPONENT KITS only.
//
// A kit is a separately-deployed bundle whose runtime values must all arrive
// through the host's import map, i.e. through the single `@erato/frontend/shared`
// specifier. `@erato/frontend/library` is the bundled copy: importing a value
// from it links a second React/provider instance into the page, so every
// override the kit registers silently applies to a context nobody renders. That
// defect is invisible in CI and unreproducible on a developer machine, so it has
// to be caught at the import statement.
//
// Do NOT run this over a host shell. The Office add-in imports values from
// `@erato/frontend/library` by design — it bundles the library instead of
// borrowing the host's, so the rule below is simply not its contract.
//
// The second, advisory half checks names against ERATO_KIT_SURFACE_EXPORTS.
// That list is only the subset of the surface the host pins by hand; the rest
// arrives through star re-exports, which are legitimate API but have nothing
// anchoring them, so a refactor elsewhere can drop one and take a kit offline.
// Hence a warning, not a failure: the name works today, and the fix is a host
// decision, not something the kit author can make at the import site.
//
// The pinned list is read from the emitted `.d.ts` rather than from
// `dist-library/shared.mjs`: that module touches `document` at module scope, so
// Node cannot import it, and the chunk it lives in is content-hash named.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHARED_SPECIFIER = "@erato/frontend/shared";
const LIBRARY_SPECIFIER = "@erato/frontend/library";

const SCANNED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
  "storybook-static",
]);

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const surfaceDeclarationPath = path.join(
  packageRoot,
  "dist-library",
  "shared",
  "kit-surface.d.ts",
);

// Null when the host tarball predates the pinned list or was never built: the
// import rule below still holds, so the advisory half is skipped rather than
// turned into a build failure a kit author cannot act on.
const readPinnedNames = () => {
  if (!fs.existsSync(surfaceDeclarationPath)) {
    return null;
  }

  const declaration = fs.readFileSync(surfaceDeclarationPath, "utf8");
  const tuple = /ERATO_KIT_SURFACE_EXPORTS\s*:\s*readonly\s*\[([^\]]*)\]/.exec(
    declaration,
  );
  if (!tuple) {
    return null;
  }

  const names = [...tuple[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  return names.length > 0 ? new Set(names) : null;
};

// Comments are blanked before matching so that prose inside an import statement
// (an apostrophe, a semicolon, a commented-out specifier) cannot steer the
// statement regex. Offsets and line breaks are preserved, so every index still
// points at the original source.
const blankComments = (source) => {
  const out = source.split("");
  let state = "code";
  let quote = "";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === "code") {
      if (character === "/" && next === "/") {
        state = "line-comment";
        out[index] = " ";
      } else if (character === "/" && next === "*") {
        state = "block-comment";
        out[index] = " ";
      } else if (character === '"' || character === "'" || character === "`") {
        state = "string";
        quote = character;
      }
      continue;
    }

    if (state === "string") {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        state = "code";
        quote = "";
      }
      continue;
    }

    if (state === "line-comment") {
      if (character === "\n") {
        state = "code";
      } else {
        out[index] = " ";
      }
      continue;
    }

    out[index] = " ";
    if (character === "*" && next === "/") {
      out[index + 1] = " ";
      index += 1;
      state = "code";
    }
  }

  return out.join("");
};

// The gap between the keyword and the specifier may span lines but may not
// contain a quote, a semicolon or a second import/export keyword. Without that
// last guard a semicolon-free statement ahead of the import — `export type X =
// …` under a `semi: false` formatter, or an object literal — is inside the
// match, so the wrong keyword decides whether the statement is type-only and
// the wrong brace group is read as its specifier list.
const STATEMENT_PATTERN = new RegExp(
  `\\b(?:import|export)\\b(?:(?!\\b(?:import|export)\\b)[^;"'\`])*?["'](${LIBRARY_SPECIFIER.replace(/\//g, "\\/")}|${SHARED_SPECIFIER.replace(/\//g, "\\/")})["']\\)?`,
  "g",
);

const isTypeOnlyStatement = (statement) =>
  /^(?:import|export)\s+type\b/.test(statement);

const namedValueSpecifiers = (statement) => {
  const braces = /\{([^}]*)\}/.exec(statement);
  if (!braces) {
    return [];
  }

  return braces[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !/^type\s/.test(entry))
    .map((entry) => entry.split(/\s+as\s+/)[0].trim())
    .filter((entry) => entry.length > 0);
};

// What a statement binds at runtime, or null when nothing survives the type
// erasure. A per-specifier `import { type X }` is erased exactly like a leading
// `import type {`, so it has no runtime binding to reject. An empty array means
// the binding is the module itself rather than a name: a default or namespace
// import, a bare side-effect import, a star re-export, a dynamic `import(...)`
// — each one links the module whatever its braces say.
const runtimeBindings = (statement) => {
  const named = namedValueSpecifiers(statement);
  if (named.length > 0) {
    return named;
  }

  const outsideBraces = statement
    .replace(/^(?:import|export)\b/, " ")
    .replace(/\{[^}]*\}/, " ")
    .replace(/["'][^"']*["']\)?$/, " ")
    .replace(/\bfrom\b/, " ")
    .trim();

  if (outsideBraces.length > 0) {
    return [];
  }

  return /\{[^}]*\}/.test(statement) ? null : [];
};

const collectSourceFiles = (target, collected) => {
  const stats = fs.statSync(target);
  if (stats.isFile()) {
    collected.push(target);
    return;
  }

  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        collectSourceFiles(path.join(target, entry.name), collected);
      }
      continue;
    }
    if (
      entry.isFile() &&
      !entry.name.endsWith(".d.ts") &&
      SCANNED_EXTENSIONS.has(path.extname(entry.name))
    ) {
      collected.push(path.join(target, entry.name));
    }
  }
};

const scanFile = (filePath, pinnedNames) => {
  const source = fs.readFileSync(filePath, "utf8");
  if (!source.includes("@erato/frontend/")) {
    return [];
  }

  const code = blankComments(source);
  const findings = [];
  STATEMENT_PATTERN.lastIndex = 0;

  let match = STATEMENT_PATTERN.exec(code);
  while (match !== null) {
    const statement = code.slice(match.index, match.index + match[0].length);
    const line = (code.slice(0, match.index).match(/\n/g)?.length ?? 0) + 1;
    const text = source.slice(match.index, match.index + match[0].length);

    if (isTypeOnlyStatement(statement)) {
      match = STATEMENT_PATTERN.exec(code);
      continue;
    }

    if (match[1] === LIBRARY_SPECIFIER) {
      const bindings = runtimeBindings(statement);
      if (bindings !== null) {
        const what =
          bindings.length > 0
            ? `imports ${bindings.map((name) => `"${name}"`).join(", ")} as a runtime value from`
            : "links the runtime module";
        findings.push({
          level: "error",
          filePath,
          line,
          text,
          reason: `${what} "${LIBRARY_SPECIFIER}"; that specifier is types-only for kits. Write "import type {" / "export type {" or prefix the specifier with "type", or take the value from "${SHARED_SPECIFIER}".`,
        });
      }
    } else if (pinnedNames !== null) {
      const unpinned = namedValueSpecifiers(statement).filter(
        (name) => !pinnedNames.has(name),
      );
      if (unpinned.length > 0) {
        findings.push({
          level: "warning",
          filePath,
          line,
          text,
          reason: `imports ${unpinned.map((name) => `"${name}"`).join(", ")} from "${SHARED_SPECIFIER}" through a star re-export. Nothing in ERATO_KIT_SURFACE_EXPORTS pins the name, so an unrelated host refactor can drop it and take this kit offline; ask the host to pin it.`,
        });
      }
    }

    match = STATEMENT_PATTERN.exec(code);
  }

  return findings;
};

const USAGE = `Usage: check-kit-manifest [path...]   (default: src)

Checks a COMPONENT KIT source tree: runtime values may only come from
"${SHARED_SPECIFIER}", "${LIBRARY_SPECIFIER}" is types-only. Not for a
host shell such as office-addin, which bundles the library on purpose.`;

export const main = (argv = []) => {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }

  const targets = argv.length > 0 ? argv : ["src"];
  const pinnedNames = readPinnedNames();
  const files = [];

  for (const target of targets) {
    const resolved = path.resolve(process.cwd(), target);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Component kit source path does not exist: ${resolved}`);
    }
    collectSourceFiles(resolved, files);
  }

  const findings = files.flatMap((filePath) => scanFile(filePath, pinnedNames));

  for (const finding of findings) {
    const relative = path.relative(process.cwd(), finding.filePath);
    const location = relative.startsWith("..") ? finding.filePath : relative;
    const report = finding.level === "error" ? console.error : console.warn;
    report(`${location}:${finding.line}: ${finding.level}: ${finding.reason}`);
    for (const line of finding.text.split("\n")) {
      report(`    ${line}`);
    }
  }

  const errors = findings.filter((finding) => finding.level === "error").length;
  const warnings = findings.length - errors;
  const scope =
    pinnedNames === null
      ? `${files.length} file(s), pinned-name check skipped (${surfaceDeclarationPath} has no ERATO_KIT_SURFACE_EXPORTS)`
      : `${files.length} file(s) against ${pinnedNames.size} pinned name(s)`;

  if (errors > 0) {
    console.error(
      `check-kit-manifest: ${errors} error(s), ${warnings} warning(s) in ${scope}.`,
    );
    process.exitCode = 1;
    return 1;
  }

  console.log(`check-kit-manifest: clean, ${warnings} warning(s) in ${scope}.`);
  return 0;
};

// argv[1] is the path as typed; Node resolves the module entry through its
// symlinks. Both have to be realpathed or a package-manager symlink makes this
// guard silently false and the whole check a no-op.
const invokedDirectly = () => {
  if (process.argv[1] === undefined) {
    return false;
  }
  try {
    return (
      fs.realpathSync(path.resolve(process.argv[1])) ===
      fileURLToPath(import.meta.url)
    );
  } catch {
    return false;
  }
};

if (invokedDirectly()) {
  main(process.argv.slice(2));
}
