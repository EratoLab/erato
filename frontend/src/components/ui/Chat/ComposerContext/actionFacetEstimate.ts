export interface ActionFacetForEstimate {
  id: string;
  args?: Readonly<Record<string, string>>;
}

const NO_ARGS: Readonly<Record<string, string>> = Object.freeze({});

const LRU_SIZE = 16;
const byContent = new Map<string, File>();
const byArgs = new WeakMap<object, { key: string; file: File }>();

const contentKey = (id: string, args: Readonly<Record<string, string>>) =>
  `${id}\u0000${JSON.stringify(args)}`;

/**
 * What a facet adds to the token estimate: its args as the request carries
 * them, not the host text they came from. Equal args give the same `File`, so
 * a chip rebuilt on every render keeps its identity and the estimate query
 * its key.
 */
export function actionFacetEstimate(facet: ActionFacetForEstimate): File {
  const args = facet.args ?? NO_ARGS;
  // A review document's args run to hundreds of KB; re-reading the same
  // object must not stringify them again.
  const known = byArgs.get(args);
  if (known?.key.startsWith(`${facet.id}\u0000`)) {
    return known.file;
  }
  const key = contentKey(facet.id, args);
  let file = byContent.get(key);
  if (file) {
    byContent.delete(key);
  } else {
    file = new File(
      [
        Object.entries(args)
          .map(([name, value]) => `${name}: ${value}`)
          .join("\n\n"),
      ],
      `${facet.id}.txt`,
      { type: "text/plain" },
    );
  }
  byContent.set(key, file);
  if (byContent.size > LRU_SIZE) {
    const oldest = byContent.keys().next().value;
    if (oldest !== undefined) {
      byContent.delete(oldest);
    }
  }
  byArgs.set(args, { key, file });
  return file;
}
