import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function listFiles(directory, predicate = () => true) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await listFiles(entryPath, predicate)));
    } else if (entry.isFile() && predicate(entryPath)) {
      result.push(entryPath);
    }
  }
  return result.sort();
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

export function catalogueDigest(document) {
  const digestInput = structuredClone(document);
  delete digestInput["x-erato-catalogue"].digest;
  return `sha256:${createHash("sha256")
    .update(canonicalJson(digestInput), "utf8")
    .digest("hex")}`;
}

export function formatAjvErrors(errors) {
  return (errors ?? [])
    .map(
      (error) =>
        `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
    )
    .join("; ");
}
