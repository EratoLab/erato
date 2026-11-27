import { i18n } from "@lingui/core";

import { toast } from "../Toast";

/**
 * Says a newer version waits while a reload would lose work in progress. It
 * stays until dismissed; reloading is the person's choice.
 */
export function showUpdateAvailableNotice(): void {
  toast.info({
    dedupeKey: "app-update-available",
    title: i18n._({
      id: "update.available.title",
      message: "A new version is available.",
    }),
    description: i18n._({
      id: "update.available.description",
      message: "Reload when you are ready. Your unsent text is kept.",
    }),
    duration: Infinity,
    actions: [
      {
        id: "update-available-reload",
        label: i18n._({ id: "error.app.reload", message: "Reload" }),
        variant: "primary",
        onClick: () => window.location.reload(),
      },
    ],
  });
}
