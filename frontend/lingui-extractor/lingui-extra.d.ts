/**
 * Lingui macro type augmentation for Erato.
 *
 * This file extends the macro descriptor overloads so repository code can pass
 * a static `extra` object to `t`, `msg`, and `defineMessage`. The custom
 * extractor reads that metadata during `i18n:extract` and turns it into PO
 * comments that the custom formatter preserves across future extracts.
 */
declare module "@lingui/core/macro" {
  import type { I18n, MessageDescriptor } from "@lingui/core";

  /**
   * A Lingui message descriptor that supports repository-specific `extra`
   * metadata while preserving Lingui's normal descriptor requirements.
   */
  type ExtraMessageDescriptor =
    | {
        comment?: string;
        context?: string;
        extra?: Record<string, unknown>;
        id: string;
        message?: string;
      }
    | {
        comment?: string;
        context?: string;
        extra?: Record<string, unknown>;
        id?: string;
        message: string;
      };

  /**
   * Placeholder values supported by Lingui's template-tag overloads.
   */
  type MessagePlaceholder = string | number | Record<string, string | number>;

  export function t(descriptor: ExtraMessageDescriptor): string;
  export function t(
    literals: TemplateStringsArray,
    ...placeholders: MessagePlaceholder[]
  ): string;
  export function t(i18n: I18n): {
    (
      literals: TemplateStringsArray,
      ...placeholders: MessagePlaceholder[]
    ): string;
    (descriptor: ExtraMessageDescriptor): string;
  };
  export function defineMessage(
    descriptor: ExtraMessageDescriptor,
  ): MessageDescriptor;
  export function defineMessage(
    literals: TemplateStringsArray,
    ...placeholders: MessagePlaceholder[]
  ): MessageDescriptor;
  export const msg: {
    (descriptor: ExtraMessageDescriptor): MessageDescriptor;
    (
      literals: TemplateStringsArray,
      ...placeholders: MessagePlaceholder[]
    ): MessageDescriptor;
  };
}
