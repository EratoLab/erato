import { useDelegatedRunOpener } from "@/providers/DelegatedRunOpenProvider";
import { getChatUrl } from "@/utils/chat/urlUtils";

import type { ReactNode } from "react";

const LINK_CLASS =
  "focus-ring-tight rounded-[var(--theme-radius-base)] underline underline-offset-2 hover:text-theme-fg-primary";

/**
 * Opens a task's own chat: through the host's opener when it has one, in a new
 * tab otherwise.
 */
export const TaskChatLink = ({
  childChatId,
  testId,
  children,
}: {
  childChatId: string;
  testId: string;
  children: ReactNode;
}) => {
  const openRun = useDelegatedRunOpener();
  return openRun ? (
    <button
      type="button"
      onClick={() => openRun(childChatId)}
      className={LINK_CLASS}
      data-testid={testId}
    >
      {children}
    </button>
  ) : (
    <a
      href={getChatUrl(childChatId)}
      target="_blank"
      rel="noopener noreferrer"
      className={LINK_CLASS}
      data-testid={testId}
    >
      {children}
    </a>
  );
};
