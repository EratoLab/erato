import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compileMdx } from "nextra/compile";
import remarkConfigMetadata from "./remark-config-metadata.mjs";

const reference = {
  "section.old": { stability: "stable", introduced_in: "0.6.0" },
  "section.new": { stability: "alpha", introduced_in: "unreleased" },
  hidden: {
    stability: "deprecated",
    introduced_in: "0.6.0",
    hide_in_docs: true,
  },
};
const marker = (key) => ({
  type: "mdxFlowExpression",
  value: `/* erato_toml_config_key: ${key} */`,
});
const contents = (node) =>
  node.value ?? (node.children ?? []).map(contents).join("");

test("renders distinct labels for grouped keys and skips hidden and section-only markers", () => {
  const tree = {
    type: "root",
    children: [
      marker("section"),
      marker("section.old"),
      marker("section.new"),
      marker("hidden"),
    ],
  };
  remarkConfigMetadata({ reference })(tree);
  assert.equal(tree.children.length, 2);
  assert.equal(
    contents(tree.children[0]),
    "section.old — Stability: stable · Introduced in: 0.6.0",
  );
  assert.equal(
    contents(tree.children[1]),
    "section.new — Stability: alpha · Introduced in: unreleased",
  );
});

test("does not duplicate a single key heading and rejects incomplete metadata", () => {
  const tree = { type: "root", children: [marker("section.old")] };
  remarkConfigMetadata({ reference })(tree);
  assert.equal(contents(tree), "Stability: stable · Introduced in: 0.6.0");
  assert.throws(
    () =>
      remarkConfigMetadata({ reference: { broken: {} } })({
        children: [marker("broken")],
      }),
    /broken.*missing lifecycle/,
  );
});

test("compiles actual config documentation markers through Nextra", async () => {
  const compiled = await compileMdx(
    "# Config\n\n{/* erato_toml_config_key: section.old */}\n\nExisting prose.",
    { mdxOptions: { remarkPlugins: [[remarkConfigMetadata, { reference }]] } },
  );
  assert.match(compiled, /Introduced in:/);
  assert.match(compiled, /0\.6\.0/);
  assert.match(compiled, /Existing prose/);
});

test("the full configuration page compiles with generated lifecycle values", async () => {
  const source = readFileSync(
    new URL("../content/docs/configuration.mdx", import.meta.url),
    "utf8",
  );
  const compiled = await compileMdx(source, {
    filePath: "content/docs/configuration.mdx",
    mdxOptions: { remarkPlugins: [remarkConfigMetadata] },
    useCachedCompiler: false,
  });
  assert.match(compiled, /config-lifecycle/);
  assert.match(compiled, /Introduced in:/);
  assert.match(compiled, /unreleased/);
});
