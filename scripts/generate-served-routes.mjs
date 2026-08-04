#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const targets = {
  frontend: {
    source: "frontend/src/App.tsx",
    output: "frontend/serve.edited.json",
  },
  "office-addin": {
    source: "office-addin/src/main.tsx",
    output: "office-addin/public/serve.json",
  },
};

const usage = () => {
  console.error(
    "Usage: node scripts/generate-served-routes.mjs [--check] [--target frontend|office-addin|all]",
  );
};

const parseArguments = () => {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const targetIndex = args.indexOf("--target");
  const target = targetIndex === -1 ? "all" : args[targetIndex + 1];
  const allowedArguments = new Set(["--check", "--target", target]);

  if (
    args.some((arg) => !allowedArguments.has(arg)) ||
    !["all", ...Object.keys(targets)].includes(target)
  ) {
    usage();
    process.exit(2);
  }

  return { check, target };
};

const findJsxTagEnd = (source, startIndex) => {
  let braceDepth = 0;
  let quote = null;

  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{") {
      braceDepth += 1;
    } else if (character === "}") {
      braceDepth -= 1;
    } else if (character === ">" && braceDepth === 0) {
      return index;
    }
  }

  throw new Error("Unterminated JSX Route tag");
};

const lineNumberAt = (source, index) =>
  source.slice(0, index).split("\n").length;

const parseRouteAttributes = (tag, source, tagIndex) => {
  const pathMatch = tag.match(/(?:^|\s)path\s*=\s*(["'])(.*?)\1/s);
  const hasPathExpression = /(?:^|\s)path\s*=\s*\{/.test(tag);
  const hasIndexAttribute = /(?:^|\s)index(?:\s|=|\/|>)/.test(tag);
  const hasElement = /(?:^|\s)element\s*=/.test(tag);

  if (hasPathExpression) {
    throw new Error(
      `Route path expressions are not supported (line ${lineNumberAt(source, tagIndex)}). Use a string path so the served-route manifest can be generated.`,
    );
  }

  return {
    path: pathMatch?.[2] ?? null,
    index: hasIndexAttribute,
    hasElement,
  };
};

const findRouteClosingTag = (source, startIndex) => {
  let searchIndex = startIndex;
  const prefix = "</Route";

  while (searchIndex < source.length) {
    const candidate = source.indexOf(prefix, searchIndex);
    if (candidate === -1) {
      return -1;
    }

    const nextCharacter = source[candidate + prefix.length];
    if (!nextCharacter || /[\s>]/.test(nextCharacter)) {
      return candidate;
    }
    searchIndex = candidate + prefix.length;
  }

  return -1;
};

const parseRouteTree = (source) => {
  const root = { path: null, index: false, hasElement: false, children: [] };
  const stack = [root];
  let index = 0;

  while (index < source.length) {
    const nextOpeningTag = source.indexOf("<Route", index);
    const nextClosingTag = findRouteClosingTag(source, index);
    const isClosingTag =
      nextClosingTag !== -1 &&
      (nextOpeningTag === -1 || nextClosingTag < nextOpeningTag);

    if (isClosingTag) {
      const closingTagEnd = source.indexOf(">", nextClosingTag);
      if (closingTagEnd === -1) {
        throw new Error("Unterminated closing JSX Route tag");
      }
      if (stack.length === 1) {
        throw new Error(
          `Unexpected closing JSX Route tag (line ${lineNumberAt(source, nextClosingTag)})`,
        );
      }
      stack.pop();
      index = closingTagEnd + 1;
      continue;
    }

    if (nextOpeningTag === -1) {
      break;
    }

    const tagNameEnd = nextOpeningTag + "<Route".length;
    const nextCharacter = source[tagNameEnd];
    if (nextCharacter && !/[\s/>]/.test(nextCharacter)) {
      index = tagNameEnd;
      continue;
    }

    const openingTagEnd = findJsxTagEnd(source, tagNameEnd);
    const tag = source.slice(nextOpeningTag, openingTagEnd + 1);
    const route = {
      ...parseRouteAttributes(tag, source, nextOpeningTag),
      children: [],
    };
    stack.at(-1).children.push(route);

    if (!/\/\s*>$/.test(tag)) {
      stack.push(route);
    }
    index = openingTagEnd + 1;
  }

  if (stack.length !== 1) {
    throw new Error("Unclosed JSX Route tag");
  }

  return root;
};

const joinRoutePaths = (parentPath, childPath) => {
  if (!childPath || childPath === "/") {
    return parentPath || "/";
  }
  if (childPath.startsWith("/")) {
    return childPath;
  }
  if (!parentPath || parentPath === "/") {
    return `/${childPath}`;
  }
  return `${parentPath}/${childPath}`;
};

const extractRoutes = (source) => {
  const routeTree = parseRouteTree(source);
  const routes = [];
  const seen = new Set();

  const visit = (route, parentPath) => {
    const currentPath = route.index
      ? parentPath || "/"
      : route.path
        ? joinRoutePaths(parentPath, route.path)
        : parentPath || "/";

    // The backend already serves `/` from index.html, and `*` must remain a
    // real 404 so unknown URLs do not become successful page responses.
    if (
      currentPath !== "/" &&
      !currentPath.includes("*") &&
      (route.index || route.hasElement)
    ) {
      if (!seen.has(currentPath)) {
        seen.add(currentPath);
        routes.push(currentPath);
      }
    }

    for (const child of route.children) {
      visit(child, currentPath);
    }
  };

  for (const route of routeTree.children) {
    visit(route, "");
  }

  return routes;
};

const renderManifest = (source) =>
  `${JSON.stringify(
    {
      rewrites: extractRoutes(source).map((route) => ({
        source: route,
        destination: "index.html",
      })),
    },
    null,
    2,
  )}\n`;

const processTarget = (name, { check }) => {
  const target = targets[name];
  const sourcePath = path.join(repositoryRoot, target.source);
  const outputPath = path.join(repositoryRoot, target.output);
  const manifest = renderManifest(fs.readFileSync(sourcePath, "utf8"));

  if (check) {
    const current = fs.readFileSync(outputPath, "utf8");
    if (current !== manifest) {
      throw new Error(
        `${target.output} is out of date. Run: node scripts/generate-served-routes.mjs --target ${name}`,
      );
    }
    console.log(`Checked ${target.output}`);
    return;
  }

  fs.writeFileSync(outputPath, manifest);
  console.log(`Generated ${target.output}`);
};

const { check, target } = parseArguments();
const targetNames = target === "all" ? Object.keys(targets) : [target];

try {
  for (const targetName of targetNames) {
    processTarget(targetName, { check });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
