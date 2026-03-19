import fs from "node:fs";
import path from "node:path";

const distRoot = path.resolve(process.cwd(), "dist-library");
const srcPrefix = "@/";
const watchMode = process.argv.includes("--watch");

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function rewriteSpecifier(sourceFilePath, specifier) {
  if (!specifier.startsWith(srcPrefix)) {
    return specifier;
  }

  const targetPath = path.resolve(distRoot, specifier.slice(srcPrefix.length));
  let relativePath = path.relative(path.dirname(sourceFilePath), targetPath);
  relativePath = toPosixPath(relativePath);

  if (!relativePath.startsWith(".")) {
    relativePath = `./${relativePath}`;
  }

  return relativePath;
}

function rewriteFile(filePath) {
  if (!filePath.endsWith(".d.ts")) {
    return;
  }

  const original = fs.readFileSync(filePath, "utf8");
  let next = original.replace(
    /from\s+(['"])@\/([^'"]+)\1/g,
    (match, quote, specifierPath) =>
      `from ${quote}${rewriteSpecifier(filePath, `@/${specifierPath}`)}${quote}`,
  );

  next = next.replace(
    /import\((['"])@\/([^'"]+)\1\)/g,
    (match, quote, specifierPath) =>
      `import(${quote}${rewriteSpecifier(filePath, `@/${specifierPath}`)}${quote})`,
  );

  if (next !== original) {
    fs.writeFileSync(filePath, next);
  }
}

function rewriteAll() {
  if (!fs.existsSync(distRoot)) {
    return;
  }

  const queue = [distRoot];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }

      rewriteFile(entryPath);
    }
  }
}

rewriteAll();

if (watchMode) {
  fs.mkdirSync(distRoot, { recursive: true });

  let timer = null;
  const scheduleRewrite = () => {
    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      rewriteAll();
      timer = null;
    }, 50);
  };

  fs.watch(distRoot, { recursive: true }, () => {
    scheduleRewrite();
  });
}
