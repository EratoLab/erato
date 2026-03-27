/**
 * Custom Lingui metadata extractor support for Erato.
 *
 * This module wraps Lingui's standard Babel extractor and adds a second,
 * repository-specific pass that reads static `extra` metadata from
 * `@lingui/core/macro` descriptor calls. It defines the descriptor types,
 * utilities for reading static values from Babel AST nodes, a Babel plugin that
 * emits extracted metadata messages, and the combined extractor exported to the
 * Lingui config.
 */
import { transformAsync } from "@babel/core";
import babelExtractorModule, {
  babelRe,
  getBabelParserOptions,
} from "@lingui/cli/api/extractors/babel";
import { generateMessageId } from "@lingui/message-utils/generateMessageId";

import type { PluginObj } from "@babel/core";
import type * as BabelTypesNamespace from "@babel/types";
import type {
  ExtractedMessage,
  ExtractorCtx,
  ExtractorType,
} from "@lingui/conf";

type BabelTypes = typeof BabelTypesNamespace;

/**
 * The descriptor fields that may be statically extracted from Lingui macros.
 */
type DescriptorFields = {
  comment?: string;
  context?: string;
  extra?: Record<string, unknown>;
  id?: string;
  message?: string;
};

const EXTRA_COMMENT_PREFIX = "js-lingui-extra:";
const MACRO_MODULES = new Set(["@lingui/core/macro"]);
const SUPPORTED_MACROS = new Set(["t", "msg", "defineMessage"]);
const babelExtractor =
  "default" in babelExtractorModule
    ? babelExtractorModule.default
    : babelExtractorModule;

/**
 * Reads a statically known string value from supported Babel AST node shapes.
 */
function getStaticText(
  t: BabelTypes,
  node: BabelTypes.Node,
): string | undefined {
  if (t.isStringLiteral(node)) {
    return node.value;
  }

  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return node.quasis.map((quasi) => quasi.value.cooked ?? "").join("");
  }

  if (t.isBinaryExpression(node, { operator: "+" })) {
    const left = getStaticText(t, node.left);
    const right = getStaticText(t, node.right);
    return left !== undefined && right !== undefined ? left + right : undefined;
  }

  return undefined;
}

/**
 * Reads a statically known JSON-like value from supported Babel AST node
 * shapes so descriptor `extra` payloads can be extracted safely.
 */
function getStaticJsonValue(
  t: BabelTypes,
  node: BabelTypes.Node,
): unknown | undefined {
  if (t.isStringLiteral(node)) {
    return node.value;
  }

  if (t.isNumericLiteral(node) || t.isBooleanLiteral(node)) {
    return node.value;
  }

  if (t.isNullLiteral(node)) {
    return null;
  }

  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return node.quasis.map((quasi) => quasi.value.cooked ?? "").join("");
  }

  if (t.isArrayExpression(node)) {
    const values: unknown[] = [];
    for (const element of node.elements) {
      if (!element) {
        return undefined;
      }

      const value = getStaticJsonValue(t, element);
      if (value === undefined) {
        return undefined;
      }

      values.push(value);
    }

    return values;
  }

  if (t.isObjectExpression(node)) {
    const result: Record<string, unknown> = {};

    for (const property of node.properties) {
      if (!t.isObjectProperty(property) || property.computed) {
        return undefined;
      }

      let key: string | undefined;
      if (t.isIdentifier(property.key)) {
        key = property.key.name;
      } else if (t.isStringLiteral(property.key)) {
        key = property.key.value;
      }

      if (!key) {
        return undefined;
      }

      const value = getStaticJsonValue(t, property.value);
      if (value === undefined) {
        return undefined;
      }

      result[key] = value;
    }

    return result;
  }

  return undefined;
}

/**
 * Finds a named object property on a Lingui descriptor object.
 */
function getObjectProperty(
  t: BabelTypes,
  node: BabelTypes.ObjectExpression,
  key: string,
): BabelTypes.ObjectProperty | undefined {
  return node.properties.find(
    (property): property is BabelTypes.ObjectProperty =>
      t.isObjectProperty(property) &&
      !property.computed &&
      ((t.isIdentifier(property.key) && property.key.name === key) ||
        (t.isStringLiteral(property.key) && property.key.value === key)),
  );
}

/**
 * Reads the static Lingui descriptor fields needed for metadata extraction.
 */
function readDescriptorFields(
  t: BabelTypes,
  node: BabelTypes.ObjectExpression,
): DescriptorFields | undefined {
  const extraProperty = getObjectProperty(t, node, "extra");
  if (!extraProperty) {
    return undefined;
  }

  const extraValue = getStaticJsonValue(t, extraProperty.value);
  if (
    !extraValue ||
    typeof extraValue !== "object" ||
    Array.isArray(extraValue)
  ) {
    return undefined;
  }

  const idProperty = getObjectProperty(t, node, "id");
  const messageProperty = getObjectProperty(t, node, "message");
  const commentProperty = getObjectProperty(t, node, "comment");
  const contextProperty = getObjectProperty(t, node, "context");

  return {
    id: idProperty ? getStaticText(t, idProperty.value) : undefined,
    message: messageProperty
      ? getStaticText(t, messageProperty.value)
      : undefined,
    comment: commentProperty
      ? getStaticText(t, commentProperty.value)
      : undefined,
    context: contextProperty
      ? getStaticText(t, contextProperty.value)
      : undefined,
    extra: extraValue as Record<string, unknown>,
  };
}

/**
 * Converts extracted `extra` metadata into the Lingui comment form that the
 * custom formatter later round-trips into `.po` files.
 */
function buildMetadataComment(
  extra: Record<string, unknown>,
  comment?: string,
): string | undefined {
  const metadataLines = Object.entries(extra)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(
      ([key, value]) =>
        `${EXTRA_COMMENT_PREFIX} ${key}=${JSON.stringify(value)}`,
    );

  if (metadataLines.length === 0) {
    return comment;
  }

  return comment
    ? [comment, ...metadataLines].join("\n")
    : metadataLines.join("\n");
}

/**
 * Creates the Babel plugin that finds supported Lingui macro calls and emits
 * metadata-only extracted messages for static descriptor `extra` values.
 */
function createMetadataExtractorPlugin(
  t: BabelTypes,
  onMessageExtracted: (msg: ExtractedMessage) => void,
): PluginObj {
  return {
    visitor: {
      Program(path, state) {
        const macroIdentifiers = new Set<string>();

        for (const statement of path.get("body")) {
          if (!statement.isImportDeclaration()) {
            continue;
          }

          if (!MACRO_MODULES.has(statement.node.source.value)) {
            continue;
          }

          for (const specifier of statement.node.specifiers) {
            if (!t.isImportSpecifier(specifier)) {
              continue;
            }

            const importedName =
              t.isIdentifier(specifier.imported) ||
              t.isStringLiteral(specifier.imported)
                ? (specifier.imported.name ?? specifier.imported.value)
                : undefined;

            if (importedName && SUPPORTED_MACROS.has(importedName)) {
              macroIdentifiers.add(specifier.local.name);
            }
          }
        }

        state.set("linguiMacroIdentifiers", macroIdentifiers);
      },
      CallExpression(path, state) {
        const identifiers = state.get("linguiMacroIdentifiers") as
          | Set<string>
          | undefined;
        if (!identifiers || identifiers.size === 0) {
          return;
        }

        if (!path.get("callee").isIdentifier()) {
          return;
        }

        const calleeName = path.node.callee.name;
        if (!identifiers.has(calleeName)) {
          return;
        }

        const firstArgument = path.get("arguments")[0];
        if (!firstArgument?.isObjectExpression()) {
          return;
        }

        const fields = readDescriptorFields(t, firstArgument.node);
        if (!fields?.extra) {
          return;
        }

        const id =
          fields.id ??
          (fields.message
            ? generateMessageId(fields.message, fields.context ?? null)
            : undefined);
        if (!id) {
          return;
        }

        const comment = buildMetadataComment(fields.extra, fields.comment);
        if (!comment) {
          return;
        }

        onMessageExtracted({
          id,
          message: fields.message,
          context: fields.context,
          comment,
          origin: [
            state.filename ?? "",
            firstArgument.node.loc?.start.line ??
              path.node.loc?.start.line ??
              0,
            firstArgument.node.loc?.start.column ??
              path.node.loc?.start.column ??
              0,
          ],
        });
      },
    },
  };
}

/**
 * Runs only the repository-specific metadata extraction pass. Tests use this
 * helper directly so they do not depend on a full Lingui macro transform.
 */
export async function extractLinguiExtraMetadata(
  filename: string,
  code: string,
  parserOptions: ExtractorCtx["linguiConfig"]["extractorParserOptions"] = {},
): Promise<ExtractedMessage[]> {
  const extractedMessages: ExtractedMessage[] = [];

  await transformAsync(code, {
    ast: false,
    babelrc: false,
    code: false,
    configFile: false,
    filename,
    parserOpts: {
      plugins: getBabelParserOptions(filename, parserOptions),
    },
    plugins: [
      ({ types }) =>
        createMetadataExtractorPlugin(types, (msg) =>
          extractedMessages.push(msg),
        ),
    ],
  });

  return extractedMessages;
}

/**
 * A combined Lingui extractor that first performs the normal message extract
 * and then emits additional metadata comments for descriptor `extra` fields.
 */
export const linguiExtraExtractor: ExtractorType = {
  match(filename) {
    return babelRe.test(filename);
  },
  async extract(filename, code, onMessageExtracted, ctx: ExtractorCtx) {
    await babelExtractor.extract(filename, code, onMessageExtracted, ctx);

    const extraMessages = await extractLinguiExtraMetadata(
      filename,
      code,
      ctx.linguiConfig.extractorParserOptions ?? {},
    );

    extraMessages.forEach(onMessageExtracted);
  },
};

export default linguiExtraExtractor;
