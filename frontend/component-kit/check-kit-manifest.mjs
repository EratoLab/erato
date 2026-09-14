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
// The declared surface is read from the emitted `.d.ts` rather than from
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

const readDeclaredSurface = () => {
  if (!fs.existsSync(surfaceDeclarationPath)) {
    throw new Error(
      `Erato shared surface declaration does not exist: ${surfaceDeclarationPath}. Build @erato/frontend first.`,
    );
  }

  const declaration = fs.readFileSync(surfaceDeclarationPath, "utf8");
  const tuple = /ERATO_KIT_SURFACE_EXPORTS\s*:\s*readonly\s*\[([^\]]*)\]/.exec(
    declaration,
  );
  if (!tuple) {
    throw new Error(
      `ERATO_KIT_SURFACE_EXPORTS is missing from ${surfaceDeclarationPath}. Rebuild @erato/frontend.`,
    );
  }

  const names = [...tuple[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (names.length === 0) {
    throw new Error(
      `ERATO_KIT_SURFACE_EXPORTS is empty in ${surfaceDeclarationPath}. Rebuild @erato/frontend.`,
    );
  }

  return new Set(names);
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
// contain a quote or a semicolon, so a match can never run across a preceding
// complete statement and mis-report its keyword or its line.
const STATEMENT_PATTERN = new RegExp(
  `\\b(?:import|export)\\b[^;"'\`]*?["'](${LIBRARY_SPECIFIER.replace(/\//g, "\\/")}|${SHARED_SPECIFIER.replace(/\//g, "\\/")})["']\\)?`,
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

const scanFile = (filePath, declaredSurface) => {
  const source = fs.readFileSync(filePath, "utf8");
  if (!source.includes("@erato/frontend/")) {
    return [];
  }

  const code = blankComments(source);
  const violations = [];
  STATEMENT_PATTERN.lastIndex = 0;

  let match = STATEMENT_PATTERN.exec(code);
  while (match !== null) {
    const statement = code.slice(match.index, match.index + match[0].length);
    const line = (code.slice(0, match.index).match(/\n/g)?.length ?? 0) + 1;
    const text = source.slice(match.index, match.index + match[0].length);

    if (match[1] === LIBRARY_SPECIFIER) {
      if (!isTypeOnlyStatement(statement)) {
        violations.push({
          filePath,
          line,
          text,
          reason: `imports runtime values from "${LIBRARY_SPECIFIER}"; that specifier is types-only for kits. Write "import type {" / "export type {", or take the value from "${SHARED_SPECIFIER}".`,
        });
      }
    } else if (!isTypeOnlyStatement(statement)) {
      const undeclared = namedValueSpecifiers(statement).filter(
        (name) => !declaredSurface.has(name),
      );
      if (undeclared.length > 0) {
        violations.push({
          filePath,
          line,
          text,
          reason: `imports ${undeclared.map((name) => `"${name}"`).join(", ")} from "${SHARED_SPECIFIER}", which the host does not declare. Add the name to ERATO_KIT_SURFACE_EXPORTS in the host's shared surface, or the kit breaks whenever an unrelated refactor drops it.`,
        });
      }
    }

    match = STATEMENT_PATTERN.exec(code);
  }

  return violations;
};

const USAGE = `Usage: check-kit-manifest [path...]   (default: src)

Checks a COMPONENT KIT source tree: runtime values may only come from
"${SHARED_SPECIFIER}", and only names the host declares. Not for host
shells such as office-addin, which bundle "${LIBRARY_SPECIFIER}" on purpose.`;

export const main = (argv = []) => {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }

  const targets = argv.length > 0 ? argv : ["src"];
  const declaredSurface = readDeclaredSurface();
  const files = [];

  for (const target of targets) {
    const resolved = path.resolve(process.cwd(), target);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Component kit source path does not exist: ${resolved}`);
    }
    collectSourceFiles(resolved, files);
  }

  const violations = files.flatMap((filePath) =>
    scanFile(filePath, declaredSurface),
  );

  for (const violation of violations) {
    const relative = path.relative(process.cwd(), violation.filePath);
    const location = relative.startsWith("..") ? violation.filePath : relative;
    console.error(`${location}:${violation.line}: ${violation.reason}`);
    for (const line of violation.text.split("\n")) {
      console.error(`    ${line}`);
    }
  }

  if (violations.length > 0) {
    console.error(
      `check-kit-manifest: ${violations.length} violation(s) in ${files.length} file(s).`,
    );
    process.exitCode = 1;
    return 1;
  }

  console.log(
    `check-kit-manifest: ${files.length} file(s) clean against ${declaredSurface.size} declared surface names.`,
  );
  return 0;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
