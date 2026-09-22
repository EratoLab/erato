#!/usr/bin/env node
// Resolve placeholders before schema validation; otherwise invalid URLs hide structural errors.
// Uses the Microsoft manifest validator, which requires network access.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const MANIFESTS = [
  { name: "manifest.xml", launchEvents: true },
  { name: "manifest-document.xml", launchEvents: false },
];

// Synthetic values in the shape the backend renders. The version is the one
// value that cannot mirror production: the backend derives it from the crate
// version, and the validator's store rule rejects anything below 1.0.
const PLACEHOLDER_VALUES = {
  OFFICE_ADDIN_ID: "5b2c4d61-7f0e-4a0a-9c46-2f3a1e8d9b10",
  OFFICE_ADDIN_MANIFEST_VERSION: "1.0.0.0",
  OFFICE_ADDIN_MANIFEST_PROVIDER_NAME: "Erato",
  OFFICE_ADDIN_MANIFEST_DISPLAY_NAME: "Erato",
  OFFICE_ADDIN_MANIFEST_DESCRIPTION: "Erato assistant for Outlook",
  OFFICE_ADDIN_MANIFEST_SUPPORT_URL: "https://example.com/support",
  OFFICE_ADDIN_MANIFEST_GROUP_LABEL: "Erato",
  OFFICE_ADDIN_MANIFEST_BUTTON_LABEL: "Open Erato",
  OFFICE_ADDIN_MANIFEST_BUTTON_DESCRIPTION: "Open the Erato task pane",
  OFFICE_ADDIN_MANIFEST_ICON_URL: "https://example.com/icon-64.png",
  OFFICE_ADDIN_MANIFEST_HIGH_RESOLUTION_ICON_URL:
    "https://example.com/icon-128.png",
  OFFICE_ADDIN_MANIFEST_ICON_16_URL: "https://example.com/icon-16.png",
  OFFICE_ADDIN_MANIFEST_ICON_32_URL: "https://example.com/icon-32.png",
  OFFICE_ADDIN_MANIFEST_ICON_80_URL: "https://example.com/icon-80.png",
};

// The three blocks router.rs renders when launch events are configured, with
// the same placeholder-owns-its-line substitution and indentation.
const LAUNCH_EVENT_BLOCKS = {
  OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_RUNTIMES: `<Runtimes>
  <Runtime resid="launchEventPageUrl">
    <Override type="javascript" resid="launchEventScriptUrl"/>
  </Runtime>
</Runtimes>`,
  OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_EXTENSION_POINT: `<ExtensionPoint xsi:type="LaunchEvent">
  <LaunchEvents>
    <LaunchEvent Type="OnNewMessageCompose" FunctionName="onNewMessageCompose"/>
  </LaunchEvents>
  <SourceLocation resid="launchEventPageUrl"/>
</ExtensionPoint>`,
  OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_URLS: `<bt:Url id="launchEventPageUrl" DefaultValue="https://example.com/public/component-kits/example/commands.html"/>
<bt:Url id="launchEventScriptUrl" DefaultValue="https://example.com/public/component-kits/example/launchevent.js"/>`,
};

function render({ manifest, template, withLaunchEvents }) {
  let rendered = template.replaceAll(
    "https://localhost:3002",
    "https://example.com",
  );
  for (const [name, block] of Object.entries(LAUNCH_EVENT_BLOCKS)) {
    const line = new RegExp(
      `^([ \\t]*)<!--\\{\\{${name}\\}\\}-->[ \\t]*\\n`,
      "m",
    );
    if (line.test(rendered) !== manifest.launchEvents) {
      throw new Error(
        manifest.launchEvents
          ? `${manifest.name} no longer carries the ${name} placeholder`
          : `${manifest.name} must not carry the ${name} placeholder`,
      );
    }
    if (!manifest.launchEvents) {
      continue;
    }
    rendered = rendered.replace(line, (_match, indent) =>
      withLaunchEvents
        ? block
            .split("\n")
            .map((blockLine) => (blockLine ? indent + blockLine : blockLine))
            .join("\n") + "\n"
        : "",
    );
  }
  for (const [name, value] of Object.entries(PLACEHOLDER_VALUES)) {
    rendered = rendered.replaceAll(`{{${name}}}`, value);
  }
  const leftovers = [...rendered.matchAll(/\{\{[A-Z0-9_]+\}\}/g)].map(
    (match) => match[0],
  );
  if (leftovers.length > 0) {
    throw new Error(
      `unrendered placeholders, add them to PLACEHOLDER_VALUES: ${[...new Set(leftovers)].join(", ")}`,
    );
  }
  return rendered;
}

const outDir = mkdtempSync(join(tmpdir(), "erato-manifest-"));
const validator = join(root, "node_modules/.bin/office-addin-manifest");
let failed = false;
for (const manifest of MANIFESTS) {
  const template = readFileSync(join(root, "manifests", manifest.name), "utf8");
  const variants = manifest.launchEvents ? [false, true] : [false];
  for (const withLaunchEvents of variants) {
    const file = join(
      outDir,
      `${manifest.name.replace(/\.xml$/, "")}${withLaunchEvents ? "-launch-events" : ""}.xml`,
    );
    writeFileSync(file, render({ manifest, template, withLaunchEvents }));
    const variantLabel = manifest.launchEvents
      ? ` ${withLaunchEvents ? "with" : "without"} launch events`
      : "";
    console.log(
      `Validating the served ${manifest.name}${variantLabel}: ${file}`,
    );
    const result = spawnSync(validator, ["validate", file], {
      stdio: "inherit",
    });
    if (result.status !== 0) failed = true;
  }
}
process.exit(failed ? 1 : 0);
