"use client";

import { useEffect } from "react";

import { useTabChatActivity } from "@/hooks/chat/useTabChatActivity";
import {
  shouldBlink,
  startBlink,
  type BlinkHandle,
} from "@/lib/favicon/blinkDriver";
import { composeBadgedIcon } from "@/lib/favicon/composeBadgedIcon";
import { applyIconHref, restoreIconLinks } from "@/lib/favicon/iconLinkManager";

/**
 * Badges the favicon while this tab's chat is generating, awaiting an approval,
 * or has finished unseen. Renders nothing, and no-ops in browsers that ignore
 * runtime favicon changes (Safari) since nothing reads the icon back.
 */
export function TabChatIndicator() {
  const activity = useTabChatActivity();

  useEffect(() => {
    if (activity === "idle") {
      restoreIconLinks();
      return;
    }

    const controller = new AbortController();
    let handle: BlinkHandle | undefined;

    const blink = activity === "working" && shouldBlink();

    const apply = async () => {
      const [badged, plain] = await Promise.all([
        composeBadgedIcon(activity),
        blink ? composeBadgedIcon(null) : Promise.resolve(null),
      ]);
      if (controller.signal.aborted || badged === null) {
        return;
      }
      applyIconHref(badged);
      if (!blink || plain === null) {
        return;
      }
      let dotVisible = true;
      handle = startBlink(() => {
        dotVisible = !dotVisible;
        applyIconHref(dotVisible ? badged : plain);
      });
    };

    void apply();

    return () => {
      controller.abort();
      handle?.stop();
    };
  }, [activity]);

  useEffect(() => restoreIconLinks, []);

  return null;
}
