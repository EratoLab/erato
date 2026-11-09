import { t } from "@lingui/core/macro";
import { useId } from "react";

import { scheduledChannelLabel } from "./scheduledItems";
import { Card } from "../Container/Card";
import { DisclosureChevron } from "../Controls/DisclosureChevron";
import { RadioCard } from "../Controls/RadioCard";
import { StatusPill } from "../Feedback/StatusPill";
import { BellIcon, ChatBubbleIcon, ComputerIcon } from "../icons";

import type { ScheduledItemChannel } from "./scheduledItems";
import type { StatusPillTone } from "../Feedback/StatusPill";
import type { DeliveryChannelStatus } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/* eslint-disable lingui/no-unlocalized-strings -- radio name and values */
export const SCHEDULED_CHANNEL_INPUT_NAME = "scheduled-channel";
const DESKTOP_NOTIFICATION = "desktop_notification";
const BROWSER_NOTIFICATION = "browser_notification";
/* eslint-enable lingui/no-unlocalized-strings */

const STATUS_TONE: Record<DeliveryChannelStatus, StatusPillTone> = {
  connected: "success",
  not_set_up: "warning",
  unavailable: "muted",
};

function channelStatusLabel(status: DeliveryChannelStatus) {
  switch (status) {
    case "connected":
      return t({
        id: "scheduled.channel.status.connected",
        message: "Connected",
      });
    case "not_set_up":
      return t({
        id: "scheduled.channel.status.notSetUp",
        message: "Not set up",
      });
    case "unavailable":
      return t({
        id: "scheduled.channel.status.unavailable",
        message: "Not available",
      });
  }
}

/** The Teams chat card's texts, naming the deployment's Teams app if known. */
function teamsChatTexts(teamsAppName: string | null) {
  if (teamsAppName) {
    return {
      helper: t({
        id: "scheduled.channel.teamsChat.helper",
        message: `Your chat with ${teamsAppName} in Microsoft Teams`,
      }),
      notSetUp: t({
        id: "scheduled.channel.teamsChat.notSetUp",
        message: `${teamsAppName} can't reach you in Teams yet. Open ${teamsAppName} in Microsoft Teams once: under Apps, search for ${teamsAppName} and open it. After that, this channel works.`,
      }),
    };
  }
  return {
    helper: t({
      id: "scheduled.channel.teamsChat.helper.unnamed",
      message: "Your chat with the assistant in Microsoft Teams",
    }),
    notSetUp: t({
      id: "scheduled.channel.teamsChat.notSetUp.unnamed",
      message:
        "The assistant can't reach you in Teams yet. Open its app in Microsoft Teams once, under Apps. After that, this channel works.",
    }),
  };
}

const comingLater = () => (
  <StatusPill tone="muted">
    {t({ id: "scheduled.channel.comingLater", message: "Coming later" })}
  </StatusPill>
);

interface ScheduledDeliverySettingsProps {
  channel: ScheduledItemChannel;
  /** Whether the chosen channel can reach the user, from the API. */
  channelStatus: DeliveryChannelStatus;
  onChannelChange: (channel: ScheduledItemChannel) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A refusal of the channel by the API. */
  error?: string;
  disabled?: boolean;
  /** What the deployment's Teams app is called; null when unknown. */
  teamsAppName?: string | null;
}

/**
 * "Advanced settings": where the item is delivered, one card per channel
 * with whether it reaches the user. The only place the form names a channel.
 */
export function ScheduledDeliverySettings({
  channel,
  channelStatus,
  onChannelChange,
  open,
  onOpenChange,
  error,
  disabled = false,
  teamsAppName = null,
}: ScheduledDeliverySettingsProps) {
  const bodyId = useId();
  const errorId = useId();
  const channelName = scheduledChannelLabel(channel);
  const teamsChat = teamsChatTexts(teamsAppName);

  return (
    <Card
      variant="expandable"
      as="section"
      expanded={open}
      bodyId={bodyId}
      size="none"
      data-ui="scheduled-delivery-settings"
      bodyClassName="border-t border-theme-border px-4 pb-4 pt-2"
      header={
        <div className="flex flex-wrap items-center gap-2 px-2 py-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => onOpenChange(!open)}
            className="theme-transition focus-ring-tight flex min-h-11 flex-1 items-center gap-2 px-2 text-left text-base font-semibold text-theme-fg-primary"
          >
            <DisclosureChevron open={open} size="md" />
            {t({
              id: "scheduled.form.advanced.title",
              message: "Advanced settings",
            })}
          </button>
          <span className="ml-auto flex shrink-0 items-center gap-2 pr-2 text-sm text-theme-fg-muted">
            {t({
              id: "scheduled.form.advanced.summary",
              message: `Deliver via ${channelName}`,
            })}
            {channelStatus !== "connected" && (
              <StatusPill tone={STATUS_TONE[channelStatus]}>
                {channelStatusLabel(channelStatus)}
              </StatusPill>
            )}
          </span>
        </div>
      }
    >
      <fieldset
        className="min-w-0"
        disabled={disabled}
        aria-describedby={error ? errorId : undefined}
      >
        <legend className="my-2 text-base font-semibold text-theme-fg-primary">
          {t({ id: "scheduled.form.deliverVia", message: "Deliver via" })}
        </legend>
        <div className="grid gap-3">
          <RadioCard
            name={SCHEDULED_CHANNEL_INPUT_NAME}
            value={channel}
            // The only channel so far, so always the chosen one.
            checked
            onChange={() => onChannelChange(channel)}
            icon={<ChatBubbleIcon className="size-5" />}
            label={channelName}
            helper={teamsChat.helper}
            trailing={
              <StatusPill tone={STATUS_TONE[channelStatus]}>
                {channelStatusLabel(channelStatus)}
              </StatusPill>
            }
          >
            {channelStatus === "not_set_up" ? (
              <p className="p-3 text-xs text-theme-fg-secondary">
                {teamsChat.notSetUp}
              </p>
            ) : channelStatus === "unavailable" ? (
              <p className="p-3 text-xs text-theme-fg-secondary">
                {t({
                  id: "scheduled.channel.teamsChat.unavailable",
                  message:
                    "Delivery via Teams chat is not available here. Ask your administrator.",
                })}
              </p>
            ) : null}
          </RadioCard>
          <RadioCard
            name={SCHEDULED_CHANNEL_INPUT_NAME}
            value={DESKTOP_NOTIFICATION}
            checked={false}
            onChange={() => undefined}
            disabled
            icon={<ComputerIcon className="size-5" />}
            label={t({
              id: "scheduled.channel.desktop",
              message: "Desktop notification",
            })}
            helper={t({
              id: "scheduled.channel.desktop.helper",
              message:
                "A notification on your computer, through the desktop app",
            })}
            trailing={comingLater()}
          />
          <RadioCard
            name={SCHEDULED_CHANNEL_INPUT_NAME}
            value={BROWSER_NOTIFICATION}
            checked={false}
            onChange={() => undefined}
            disabled
            icon={<BellIcon className="size-5" />}
            label={t({
              id: "scheduled.channel.browser",
              message: "Browser notification",
            })}
            helper={t({
              id: "scheduled.channel.browser.helper",
              message:
                "A notification from your browser while this app is open",
            })}
            trailing={comingLater()}
          />
        </div>
        {error && (
          <p
            id={errorId}
            role="alert"
            className="mt-2 text-sm text-theme-error-fg"
          >
            {error}
          </p>
        )}
      </fieldset>
    </Card>
  );
}
