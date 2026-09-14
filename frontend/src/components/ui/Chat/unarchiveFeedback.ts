import { t } from "@lingui/core/macro";

import { toast } from "../Toast/toast";

/**
 * Nothing about a row changes when unarchiving fails, so the toast is the only
 * signal.
 */
export const notifyUnarchiveFailed = () =>
  toast.error({
    title: t({
      id: "chat.history.unarchiveFailed",
      message: "Couldn't unarchive the chat",
    }),
  });
