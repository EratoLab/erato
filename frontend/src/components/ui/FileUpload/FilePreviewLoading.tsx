import { t } from "@lingui/core/macro";
import { memo } from "react";

import { AttachmentNotice } from "./AttachmentNotice";

interface FilePreviewLoadingProps {
  /** Optional loading label */
  label?: string;
  /** Optional secondary text */
  description?: string;
  /** Additional CSS class name */
  className?: string;
}

/**
 * The framed wait standing where a file chip will be — the notice's busy form
 * under its own name, which six preview renderers and the component kits
 * import by this module path.
 */
export const FilePreviewLoading = memo<FilePreviewLoadingProps>(
  ({
    label = t({ id: "chat.file.loading", message: "Loading file..." }),
    description = t`Please wait`,
    className = "",
  }) => (
    <AttachmentNotice
      label={label}
      description={description}
      busy
      className={className}
    />
  ),
);

// eslint-disable-next-line lingui/no-unlocalized-strings
FilePreviewLoading.displayName = "FilePreviewLoading";
