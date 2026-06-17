/**
 * Lingui macro type augmentation for Erato.
 *
 * This file extends the macro descriptor overloads so repository code can pass
 * a static `extra` object to `t`, `msg`, and `defineMessage`. The custom
 * extractor reads that metadata during `i18n:extract` and turns it into PO
 * comments that the custom formatter preserves across future extracts.
 */
import type { I18n, MessageDescriptor } from "@lingui/core";
import "@lingui/core/macro";
import "@lingui/core/macro/index";

/**
 * A Lingui message descriptor that supports repository-specific `extra`
 * metadata while preserving Lingui's normal descriptor requirements.
 */
type ExtraMessageDescriptor = (
  | {
      id: string;
      message?: string;
    }
  | {
      id?: string;
      message: string;
    }
) & {
  comment?: string;
  context?: string;
  extra?: Record<string, unknown>;
};

/**
 * Placeholder values supported by Lingui's template-tag overloads.
 */
type MessagePlaceholder = string | number | Record<string, string | number>;

declare module "@lingui/core/macro" {
  export function t(
    descriptor: ExtraMessageDescriptor | MessageDescriptor,
  ): string;
  export function t(i18n: I18n): {
    (
      literals: TemplateStringsArray,
      ...placeholders: MessagePlaceholder[]
    ): string;
    (descriptor: ExtraMessageDescriptor | MessageDescriptor): string;
  };
  export function defineMessage(
    descriptor: ExtraMessageDescriptor,
  ): MessageDescriptor;
}

declare module "@lingui/core/macro/index" {
  export function t(
    descriptor: ExtraMessageDescriptor | MessageDescriptor,
  ): string;
  export function t(i18n: I18n): {
    (
      literals: TemplateStringsArray,
      ...placeholders: MessagePlaceholder[]
    ): string;
    (descriptor: ExtraMessageDescriptor | MessageDescriptor): string;
  };
  export function defineMessage(
    descriptor: ExtraMessageDescriptor,
  ): MessageDescriptor;
}
