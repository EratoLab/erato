/* eslint-disable lingui/no-unlocalized-strings -- JSON pointers into a schema */
/** The keywords these walks follow; a schema has others besides. */
export type JsonSchema = {
  $ref?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  enum?: unknown[];
  [keyword: string]: unknown;
};

const resolve = (root: JsonSchema, ref: string): [JsonSchema, string] => {
  const path = ref.replace(/^#\//, "").split("/");
  let node: unknown = root;
  for (const segment of path) node = (node as Record<string, unknown>)[segment];
  return [node as JsonSchema, ref];
};

/**
 * Everything a schema lets a document hold: each object property, each
 * enum value, and each `oneOf` alternative, named by the JSON pointer of the
 * schema that declares it.
 */
export function schemaFeatures(root: JsonSchema): Set<string> {
  const features = new Set<string>();
  const seen = new Set<string>();
  const visit = (node: JsonSchema, pointer: string) => {
    if (seen.has(pointer)) return;
    seen.add(pointer);
    if (node.$ref) {
      const [target, at] = resolve(root, node.$ref);
      visit(target, at);
      return;
    }
    node.enum?.forEach((value) => features.add(`${pointer}=${String(value)}`));
    node.oneOf?.forEach((branch, index) => {
      features.add(`${pointer}/oneOf/${index}`);
      visit(branch, `${pointer}/oneOf/${index}`);
    });
    for (const [key, property] of Object.entries(node.properties ?? {})) {
      features.add(`${pointer}.${key}`);
      visit(property, `${pointer}/properties/${key}`);
    }
    if (node.items) visit(node.items, `${pointer}/items`);
  };
  visit(root, "#");
  return features;
}

/**
 * The features one document uses. `matches(pointer, value)` says whether the
 * value fits the schema at that pointer, to follow the `oneOf` it takes.
 */
export function usedFeatures(
  root: JsonSchema,
  document: unknown,
  matches: (pointer: string, value: unknown) => boolean,
): Set<string> {
  const used = new Set<string>();
  const visit = (node: JsonSchema, pointer: string, value: unknown) => {
    if (node.$ref) {
      const [target, at] = resolve(root, node.$ref);
      visit(target, at, value);
      return;
    }
    if (node.enum) used.add(`${pointer}=${String(value)}`);
    node.oneOf?.forEach((branch, index) => {
      const at = `${pointer}/oneOf/${index}`;
      if (matches(at, value)) {
        used.add(at);
        visit(branch, at, value);
      }
    });
    if (node.properties && typeof value === "object" && value !== null) {
      for (const [key, child] of Object.entries(value)) {
        const property = node.properties[key] as JsonSchema | undefined;
        if (!property) continue;
        used.add(`${pointer}.${key}`);
        visit(property, `${pointer}/properties/${key}`, child);
      }
    }
    if (node.items && Array.isArray(value)) {
      for (const element of value)
        visit(node.items, `${pointer}/items`, element);
    }
  };
  visit(root, "#", document);
  return used;
}
