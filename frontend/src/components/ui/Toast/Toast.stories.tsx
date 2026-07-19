import { Toaster } from "./Toaster";
import { toast } from "./toast";
import { useToastStore } from "./toastStore";
import { Button } from "../Controls/Button";

import type { Meta, StoryObj } from "@storybook/react";

// Toasts are fired imperatively via the `toast` API and rendered by a single
// <Toaster/> mounted at the app root. These stories mount their own <Toaster/>
// and fire from a trigger button so the live, transient behaviour is visible.
const meta = {
  title: "UI/Toast/Toast",
  component: Toaster,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Transient, non-blocking notification. Auto-dismisses after ~5s " +
          "(non-error, no actions) or stays until dismissed when it carries " +
          "actions. It is NOT a consent gate — it informs after the fact. " +
          "Fired via the imperative `toast` API (`toast.success`, `toast.custom`, …).",
      },
    },
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="flex min-h-[260px] flex-wrap items-start justify-center gap-2 bg-theme-bg-secondary p-8">
        <Story />
        <Toaster />
      </div>
    ),
  ],
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The four semantic variants. */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          toast.info({
            title: "Heads up",
            description: "Something informational happened.",
          })
        }
      >
        Info
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => toast.success({ title: "Saved" })}
      >
        Success
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          toast.warning({
            title: "Check this",
            description: "A non-blocking warning.",
          })
        }
      >
        Warning
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          toast.error({
            title: "Could not save",
            description: "The request failed.",
          })
        }
      >
        Error
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => useToastStore.getState().clear()}
      >
        Clear all
      </Button>
    </div>
  ),
};

/** A toast that carries actions stays until the user acts or dismisses it. */
export const WithActions: Story = {
  render: () => (
    <Button
      variant="secondary"
      size="sm"
      onClick={() =>
        toast.custom({
          variant: "info",
          title: "Message sent",
          description: "You can undo this for a few seconds.",
          actions: [
            {
              id: "undo",
              label: "Undo",
              variant: "primary",
              onClick: () => toast.success({ title: "Undone" }),
            },
          ],
          duration: 8000,
        })
      }
    >
      Show toast with action
    </Button>
  ),
};

/**
 * "How it would surface for the queue overwrite" — Option D: overwrite the
 * queued message immediately, then offer a transient Undo. This is the toast
 * alternative to a confirm-first dialog/card: recoverable, but the previously
 * queued item is lost if the Undo window lapses (and it detaches the decision
 * from the composer chip it concerns).
 */
export const SurfacedReplaceUndo: Story = {
  render: () => (
    <Button
      variant="secondary"
      size="sm"
      onClick={() =>
        toast.custom({
          variant: "info",
          title: "Queued message replaced",
          description: "Your previously queued message was overwritten.",
          actions: [
            {
              id: "undo",
              label: "Undo",
              variant: "primary",
              onClick: () =>
                toast.success({
                  title: "Restored the previous queued message",
                }),
            },
          ],
          duration: 6000,
          dedupeKey: "queue-replace",
        })
      }
    >
      Queue (replaces existing)
    </Button>
  ),
};
