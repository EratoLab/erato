import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceDir = path.join(rootDir, "src");
const componentsDir = path.join(sourceDir, "components");
const registryPath = path.join(sourceDir, "config", "componentRegistry.ts");
const outputPath = path.join(
  sourceDir,
  "shared",
  "component-registry.generated.ts",
);
const watchMode = process.argv.includes("--watch");
const sourceExtensions = [".ts", ".tsx"];

const isWithin = (parentPath, childPath) => {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath !== "" && !relativePath.startsWith(`..${path.sep}`);
};

const resolveLocalModule = (importerPath, specifier) => {
  let unresolvedPath;

  if (specifier.startsWith("@/")) {
    unresolvedPath = path.join(sourceDir, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    unresolvedPath = path.resolve(path.dirname(importerPath), specifier);
  } else {
    return null;
  }

  const candidates = path.extname(unresolvedPath)
    ? [unresolvedPath]
    : [
        ...sourceExtensions.map((extension) => `${unresolvedPath}${extension}`),
        ...sourceExtensions.map((extension) =>
          path.join(unresolvedPath, `index${extension}`),
        ),
      ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
};

const componentSourcePath = (sourceFile) => {
  const filePath = path.resolve(rootDir, sourceFile.fileName);
  return !sourceFile.isDeclarationFile && isWithin(componentsDir, filePath)
    ? filePath
    : null;
};

const aliasedSymbol = (checker, symbol) =>
  symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;

const addSymbolSources = (checker, symbol, dependencies) => {
  const targetSymbol = aliasedSymbol(checker, symbol);
  for (const declaration of targetSymbol.declarations ?? []) {
    const filePath = componentSourcePath(declaration.getSourceFile());
    if (filePath) {
      dependencies.add(filePath);
    }
  }
};

const addBindingSource = (checker, binding, dependencies) => {
  const symbol = checker.getSymbolAtLocation(binding);
  if (symbol) {
    addSymbolSources(checker, symbol, dependencies);
  }
};

const addModuleExportSources = (checker, moduleSpecifier, dependencies) => {
  const moduleSymbol = checker.getSymbolAtLocation(moduleSpecifier);
  if (!moduleSymbol) {
    return;
  }

  for (const moduleExport of checker.getExportsOfModule(moduleSymbol)) {
    addSymbolSources(checker, moduleExport, dependencies);
  }
};

const localComponentDependencies = (program, checker, filePath) => {
  const sourceFile =
    program.getSourceFile(filePath) ??
    program.getSourceFile(path.relative(rootDir, filePath));
  if (!sourceFile) {
    throw new Error(
      `TypeScript did not load ${path.relative(rootDir, filePath)}`,
    );
  }

  const dependencies = new Set();

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!statement.importClause) {
        const dependencyPath = resolveLocalModule(
          filePath,
          statement.moduleSpecifier.text,
        );
        if (dependencyPath && isWithin(componentsDir, dependencyPath)) {
          dependencies.add(dependencyPath);
        }
        continue;
      }

      if (statement.importClause.name) {
        addBindingSource(checker, statement.importClause.name, dependencies);
      }

      const namedBindings = statement.importClause.namedBindings;
      if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const importSpecifier of namedBindings.elements) {
          addBindingSource(checker, importSpecifier.name, dependencies);
        }
      } else if (namedBindings && ts.isNamespaceImport(namedBindings)) {
        addModuleExportSources(
          checker,
          statement.moduleSpecifier,
          dependencies,
        );
      }
      continue;
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const exportSpecifier of statement.exportClause.elements) {
          addBindingSource(checker, exportSpecifier.name, dependencies);
        }
      } else {
        addModuleExportSources(
          checker,
          statement.moduleSpecifier,
          dependencies,
        );
      }
    }
  }

  return [...dependencies];
};

const hasModifier = (node, modifierKind) =>
  node.modifiers?.some((modifier) => modifier.kind === modifierKind) ?? false;

const bindingNames = (bindingName) => {
  if (ts.isIdentifier(bindingName)) {
    return [bindingName.text];
  }

  return bindingName.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
};

const defaultExportName = (filePath) => {
  const basename = path.basename(filePath, path.extname(filePath));
  return basename === "index"
    ? path.basename(path.dirname(filePath))
    : basename;
};

const ownExports = (filePath) => {
  const sourceText = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const exports = [];

  for (const statement of sourceFile.statements) {
    if (
      (ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement)) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      exports.push({ name: statement.name.text, typeOnly: true });
      continue;
    }

    if (
      (ts.isClassDeclaration(statement) ||
        ts.isFunctionDeclaration(statement)) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      exports.push({
        name: statement.name?.text ?? defaultExportName(filePath),
        typeOnly: false,
        defaultExport: hasModifier(statement, ts.SyntaxKind.DefaultKeyword),
      });
      continue;
    }

    if (
      ts.isEnumDeclaration(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      exports.push({ name: statement.name.text, typeOnly: false });
      continue;
    }

    if (
      ts.isVariableStatement(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) {
          exports.push({ name, typeOnly: false });
        }
      }
      continue;
    }

    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      exports.push({
        name: ts.isIdentifier(statement.expression)
          ? statement.expression.text
          : defaultExportName(filePath),
        typeOnly: false,
        defaultExport: true,
      });
      continue;
    }

    if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const exportSpecifier of statement.exportClause.elements) {
        exports.push({
          name: exportSpecifier.name.text,
          typeOnly: statement.isTypeOnly || exportSpecifier.isTypeOnly,
        });
      }
    }
  }

  return exports;
};

const collectRegistryComponentModules = () => {
  const configPath = path.join(rootDir, "tsconfig.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"),
    );
  }
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    rootDir,
  );
  const program = ts.createProgram(
    parsedConfig.fileNames,
    parsedConfig.options,
  );
  const checker = program.getTypeChecker();
  const registryRoots = localComponentDependencies(
    program,
    checker,
    registryPath,
  );
  const componentModules = new Set();
  const pendingModules = [...registryRoots];

  while (pendingModules.length > 0) {
    const modulePath = pendingModules.pop();
    if (!modulePath || componentModules.has(modulePath)) {
      continue;
    }

    componentModules.add(modulePath);
    pendingModules.push(
      ...localComponentDependencies(program, checker, modulePath),
    );
  }

  return [...componentModules].sort();
};

const moduleSpecifierFor = (filePath) => {
  const relativePath = path.relative(sourceDir, filePath);
  const extension = path.extname(relativePath);
  return `@/${relativePath.slice(0, -extension.length).split(path.sep).join("/")}`;
};

const generatedSource = () => {
  const exportsByName = new Map();

  for (const modulePath of collectRegistryComponentModules()) {
    for (const moduleExport of ownExports(modulePath)) {
      const candidate = { ...moduleExport, modulePath };
      const existing = exportsByName.get(moduleExport.name);

      if (!existing || (existing.typeOnly && !candidate.typeOnly)) {
        exportsByName.set(moduleExport.name, candidate);
        continue;
      }

      if (
        existing.modulePath !== candidate.modulePath &&
        existing.typeOnly === candidate.typeOnly
      ) {
        throw new Error(
          `Conflicting export ${moduleExport.name}:\n- ${path.relative(rootDir, existing.modulePath)}\n- ${path.relative(rootDir, candidate.modulePath)}`,
        );
      }
    }
  }

  const exportsByModule = new Map();
  for (const moduleExport of exportsByName.values()) {
    const moduleExports = exportsByModule.get(moduleExport.modulePath) ?? [];
    moduleExports.push(moduleExport);
    exportsByModule.set(moduleExport.modulePath, moduleExports);
  }

  const exportStatements = [...exportsByModule.entries()]
    .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
    .flatMap(([modulePath, moduleExports]) => {
      const moduleSpecifier = moduleSpecifierFor(modulePath);
      const defaultExports = moduleExports.filter(
        (moduleExport) => moduleExport.defaultExport,
      );
      const valueExports = moduleExports.filter(
        (moduleExport) => !moduleExport.typeOnly && !moduleExport.defaultExport,
      );
      const typeExports = moduleExports.filter(
        (moduleExport) => moduleExport.typeOnly,
      );
      const statements = defaultExports.map(
        (moduleExport) =>
          `export { default as ${moduleExport.name} } from "${moduleSpecifier}";`,
      );

      statements.push(
        ...valueExports
          .map((moduleExport) => moduleExport.name)
          .sort()
          .map((name) => `export { ${name} } from "${moduleSpecifier}";`),
        ...typeExports
          .map((moduleExport) => moduleExport.name)
          .sort()
          .map((name) => `export type { ${name} } from "${moduleSpecifier}";`),
      );

      return statements;
    });

  return [
    "// This file is generated by scripts/generate-component-registry-shared-exports.mjs.",
    "// It exposes registry component roots and their transitive component dependencies.",
    "// Do not edit it by hand.",
    "",
    ...exportStatements,
    "",
  ].join("\n");
};

const generate = () => {
  const nextSource = generatedSource();
  const currentSource = fs.existsSync(outputPath)
    ? fs.readFileSync(outputPath, "utf8")
    : null;

  if (currentSource === nextSource) {
    return;
  }

  fs.writeFileSync(outputPath, nextSource);
  console.log(
    `[component-registry-shared] wrote ${path.relative(rootDir, outputPath)}`,
  );
};

generate();

if (watchMode) {
  let settleTimer;
  const scheduleGenerate = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(generate, 100);
  };

  fs.watch(componentsDir, { recursive: true }, scheduleGenerate);
  fs.watch(registryPath, scheduleGenerate);
  console.log("[component-registry-shared] watching component registry graph");
}
