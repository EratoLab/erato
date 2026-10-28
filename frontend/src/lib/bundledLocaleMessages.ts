import type { Messages } from "@lingui/core";

/** The catalog compiled into this build, or null when it cannot be loaded. */
export async function loadBundledLocaleMessages(
  locale: string,
): Promise<Messages | null> {
  try {
    // eslint-disable-next-line lingui/no-unlocalized-strings -- a module path
    const { messages } = (await import(`../locales/${locale}/messages.po`)) as {
      messages: Messages;
    };
    return messages;
  } catch {
    return null;
  }
}
