import { readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import * as sharedBarrel from "..";
import * as kitSurface from "../kit-surface";
import { ERATO_KIT_SURFACE_EXPORTS } from "../kit-surface";

// A kit is one flat named import, so a name that quietly leaves the surface
// fails module linking before the kit's entry runs — no handshake, no warning,
// every override silently back to its default. ERATO_KIT_SURFACE_EXPORTS is the
// string half of that contract and other packages diff against it, so it has to
// stay in lockstep with what the module actually pins.
const SOURCE_PATH = join(process.cwd(), "src/shared/kit-surface.ts");

interface PinnedNames {
  values: string[];
  types: string[];
}

// Parsed rather than matched with a regex: `export type { … }` and a per-
// specifier `export { type Foo }` are the same thing to the type checker and
// have to land in the same bucket, which only the AST tells us reliably.
function pinnedNames(): PinnedNames {
  const sourceFile = ts.createSourceFile(
    SOURCE_PATH,
    readFileSync(SOURCE_PATH, "utf8"),
    ts.ScriptTarget.ESNext,
    true,
  );
  const values: string[] = [];
  const types: string[] = [];

  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        const bucket =
          statement.isTypeOnly || element.isTypeOnly ? types : values;
        bucket.push(element.name.text);
      }
      continue;
    }

    if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          values.push(declaration.name.text);
        }
      }
    }
  }

  return { values, types };
}

describe("kit surface export manifest", () => {
  const { values, types } = pinnedNames();

  it("lists every name the module pins, and nothing else", () => {
    const declared = [...ERATO_KIT_SURFACE_EXPORTS];
    const pinned = [...values, ...types].sort();

    // Both directions: a forgotten array entry is as much a contract break as
    // an entry naming an export that no longer exists.
    expect(declared).toEqual(pinned);

    // The walk only understands the two export syntaxes this module uses, so
    // an `export function` or `export class` added later would be pinned by
    // the module and invisible to every assertion here. The runtime namespace
    // is syntax-agnostic and lists exactly the value half, which is the half
    // the walk could miss.
    expect(Object.keys(kitSurface).sort()).toEqual([...values].sort());
  });

  it("is sorted and free of duplicates", () => {
    const declared = [...ERATO_KIT_SURFACE_EXPORTS];

    expect(declared).toEqual([...declared].sort());
    expect(new Set(declared).size).toBe(declared.length);
  });

  it("resolves every value name from the module", () => {
    // Type names cannot exist at runtime; `tsc --noEmit` is what proves those
    // resolve, and the manifest test above is what keeps them listed.
    //
    // Checked for a defined value rather than with `in`: the namespace object
    // exposes every re-exported name as a getter, so a name the source module
    // does not actually provide — a type re-exported as a value, say — is
    // present but undefined. Nothing pinned here is legitimately undefined.
    const namespace: Record<string, unknown> = kitSurface;
    const missing = values.filter((name) => namespace[name] === undefined);

    expect(values.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it("reaches kits through the shared barrel", () => {
    // `index.ts` is what `@erato/frontend/shared` resolves to, so pinning a
    // name in kit-surface.ts only counts if the barrel re-exports it. Dropping
    // the star would leave every test above green and kill every kit at link
    // time.
    const barrel: Record<string, unknown> = sharedBarrel;
    const unreachable = values.filter((name) => barrel[name] === undefined);

    expect(unreachable).toEqual([]);
  });

  it("keeps the major pinned while the minor tracks additive growth", () => {
    // Kits compare the major with a strict `!==` in kit-side code, so bumping
    // it makes every deployed kit log an error until it is rebuilt.
    expect(kitSurface.ERATO_SHARED_SURFACE_VERSION).toBe(1);
    expect(kitSurface.ERATO_SHARED_SURFACE_MINOR).toBeGreaterThanOrEqual(6);
  });
});
