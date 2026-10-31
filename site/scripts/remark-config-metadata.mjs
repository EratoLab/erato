import { readFileSync } from "node:fs";

const referenceUrl = new URL(
  "../../backend/generated/config_reference.json",
  import.meta.url,
);
const markerPattern = /^\/\*\s*erato_toml_config_key:\s*`?([^`]*?)`?\s*\*\/$/;

function markerKey(node) {
  return node.type === "mdxFlowExpression"
    ? markerPattern.exec(node.value.trim())?.[1].trim()
    : undefined;
}

function label(key, metadata, showKey) {
  return {
    type: "paragraph",
    data: { hProperties: { className: ["config-lifecycle"] } },
    children: [
      ...(showKey
        ? [
            { type: "inlineCode", value: key },
            { type: "text", value: " — " },
          ]
        : []),
      { type: "strong", children: [{ type: "text", value: "Stability:" }] },
      { type: "text", value: ` ${metadata.stability} · ` },
      { type: "strong", children: [{ type: "text", value: "Introduced in:" }] },
      { type: "text", value: ` ${metadata.introduced_in}` },
    ],
  };
}

/** Render existing documentation markers from the generated reference at build time. */
export default function remarkConfigMetadata({
  reference: suppliedReference,
} = {}) {
  return (tree) => {
    let reference = suppliedReference;
    function visit(parent) {
      if (!parent.children) return;
      const children = [];
      for (let index = 0; index < parent.children.length; index++) {
        const node = parent.children[index];
        if (markerKey(node) === undefined) {
          visit(node);
          children.push(node);
          continue;
        }
        reference ??= JSON.parse(readFileSync(referenceUrl, "utf8"));
        const records = [];
        // Several keys may share one prose section. Identify their labels when
        // markers are adjacent, rather than showing anonymous repeated values.
        while (index < parent.children.length) {
          const key = markerKey(parent.children[index]);
          if (key === undefined) break;
          const metadata = reference[key];
          if (metadata && !metadata.hide_in_docs) {
            if (!metadata.stability || !metadata.introduced_in) {
              throw new Error(
                `Config key '${key}' is missing lifecycle metadata`,
              );
            }
            records.push([key, metadata]);
          }
          // Section markers have no exact entry: do not invent a shared value.
          index++;
        }
        index--;
        children.push(
          ...records.map(([key, metadata]) =>
            label(key, metadata, records.length > 1),
          ),
        );
      }
      parent.children = children;
    }
    visit(tree);
  };
}
