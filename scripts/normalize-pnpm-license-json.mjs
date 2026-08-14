#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

let input = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});

process.stdin.on("end", () => {
  const licenses = JSON.parse(input);

  if (Array.isArray(licenses)) {
    process.stdout.write(JSON.stringify(licenses));
    return;
  }

  if (!licenses || typeof licenses !== "object" || "error" in licenses) {
    throw new Error("pnpm returned an invalid license list");
  }

  const normalizedLicenses = Object.fromEntries(
    Object.entries(licenses).map(([license, packages]) => {
      if (!Array.isArray(packages)) {
        throw new Error("pnpm returned an invalid license group");
      }

      return [
        license,
        packages.map(({ versions, paths, ...packageInfo }) => {
          if (!Array.isArray(versions) || !Array.isArray(paths)) {
            throw new Error("pnpm returned invalid package versions or paths");
          }

          return {
            ...packageInfo,
            versions: versions.map(
              (version, index) => version ?? readPackageVersion(paths[index]),
            ),
            paths,
          };
        }),
      ];
    }),
  );

  process.stdout.write(JSON.stringify(normalizedLicenses));
});

const readPackageVersion = (packagePath) => {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(packagePath, "package.json"), "utf8"),
    );
    return typeof packageJson.version === "string"
      ? packageJson.version
      : "unknown";
  } catch {
    return "unknown";
  }
};
