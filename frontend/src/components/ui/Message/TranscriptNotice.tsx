import clsx from "clsx";

import type { ReactNode } from "react";

interface TranscriptNoticeProps {
  /** The notice text. */
  children: ReactNode;
  /** Optional leading icon; render it `aria-hidden`, the text carries the meaning. */
  icon?: ReactNode;
  /** Vertical spacing and tone are the caller's, so each notice keeps its own rhythm. */
  className?: string;
  style?: React.CSSProperties;
  role?: "note";
  "data-testid"?: string;
}

/**
 * Centered, quiet annotation between messages — the shared shape for anything
 * that comments on the transcript itself rather than on one message's content.
 * Message-scoped footnotes align with the message text instead and do not
 * belong here.
 */
export const TranscriptNotice = ({
  children,
  icon,
  className,
  style,
  role,
  "data-testid": dataTestId,
}: TranscriptNoticeProps) => (
  <div
    role={role}
    data-testid={dataTestId}
    className={clsx(
      "flex w-full items-center justify-center text-xs",
      className,
    )}
    style={{ gap: "var(--theme-spacing-control-gap)", ...style }}
  >
    {icon}
    <span>{children}</span>
  </div>
);
