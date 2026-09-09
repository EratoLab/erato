import { useState } from "react";

import { Card } from "../../components/ui/Container/Card";
import { DisclosureChevron } from "../../components/ui/Controls/DisclosureChevron";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Card",
  component: Card,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: `
One framed surface, for every family that has one: the settings panels, the hub cards, the search
results, the selectable option cards and the attachment frames. A customer theme reaches all of them
through the geometry class and the \`data-ui\` hook.

\`\`\`css
[data-ui="card"] { … }         /* every card that names no hook of its own */
.card-geometry { … }           /* the corner, from --card-radius */
.card-skin { … }               /* border, fill and shadow, through --card-* */
.card-body-geometry { … }      /* the inset, and the step a nested card reads */
\`\`\`

## Two knobs, not one

\`.card-skin\` is the only rule that sets a final value; tone, hover, selection and expansion move
the variables it reads. So \`--card-border: transparent\` retunes the resting colour and leaves
hover and selection on the host tokens, while \`border-color: transparent\` catches every state at
once. Anything off the inset scale is set at the site with \`--card-inset\`.

## Nesting stays concentric

The body publishes \`--card-child-radius\` and \`--card-child-inset\`; a card marked \`nested\`
reads them instead of the token. Both derivations carry a \`max(0px, …)\` floor, so a deep nest
squares off rather than inverting. The publication lives on the body and not on the frame on
purpose: a frame that declared what it also reads would be a custom-property cycle.

## Bands and the missing clip

\`media\`, \`header\`, \`footer\` and the body are named slots rather than free children, because the
corner policy depends on their order — \`.card-section\` rounds the first and last band to the frame.
That is what lets the frame skip \`overflow: hidden\`, which would crop the offset focus ring of any
control inside a band.

## State

\`selected\` emits \`data-selected\` and \`expanded\` emits \`data-expanded\`, both as presence
attributes on the **frame**, never \`="false"\`; the disclosure control in the header keeps
\`aria-expanded\`. \`control\` says which native control carries the choice: \`radio\` and
\`checkbox\` leave the ARIA to the input inside and only draw its focus ring, while \`none\` makes
the frame itself the toggle with \`aria-pressed\`.
        `,
      },
    },
  },
  argTypes: {
    variant: {
      control: "radio",
      options: ["surface", "interactive", "selectable", "expandable"],
    },
    as: {
      control: "select",
      options: ["div", "section", "article", "a", "button", "label", "ul"],
    },
    control: { control: "radio", options: ["radio", "checkbox", "none"] },
    tone: {
      control: "select",
      options: [
        "neutral",
        "muted",
        "accent",
        "info",
        "success",
        "warning",
        "error",
      ],
    },
    size: {
      control: "select",
      options: ["none", "xs", "sm", "md", "lg", "xl"],
    },
    bordered: { control: "boolean" },
    nested: { control: "boolean" },
    selected: { control: "boolean" },
    stickyHeader: { control: "boolean" },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

const Title = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm font-medium text-theme-fg-primary">{children}</p>
);

const Caption = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-1 text-xs text-theme-fg-muted">{children}</p>
);

export const Surface: Story = {
  args: {
    variant: "surface",
    as: "section",
    children: (
      <>
        <Title>Release notes assistant</Title>
        <Caption>Drafts changelogs from merged pull requests.</Caption>
      </>
    ),
  },
};

/** The frame is the click target, so it takes the tag that can be one. */
export const Interactive: Story = {
  args: {
    variant: "interactive",
    as: "button",
    className: "w-full text-left",
    children: (
      <>
        <Title>Engineering</Title>
        <Caption>12 assistants</Caption>
      </>
    ),
  },
};

/** Every inset step, and a nested card deriving both of its own from the frame. */
export const Insets: Story = {
  args: { variant: "surface" },
  render: () => (
    <div className="flex flex-col gap-4">
      {(["none", "xs", "sm", "md", "lg", "xl"] as const).map((size) => (
        <Card key={size} variant="surface" size={size}>
          <Title>{size}</Title>
        </Card>
      ))}
      <Card variant="surface" size="xl">
        <Title>Outer card</Title>
        <Card variant="surface" nested className="mt-3">
          <Caption>
            Corner and inset derived from the card around this one.
          </Caption>
        </Card>
      </Card>
    </div>
  ),
};

/** Fill and border move together through the skin's variables. */
export const Tones: Story = {
  args: { variant: "surface" },
  render: () => (
    <div className="flex flex-col gap-3">
      {(
        [
          "neutral",
          "muted",
          "accent",
          "info",
          "success",
          "warning",
          "error",
        ] as const
      ).map((tone) => (
        <Card key={tone} variant="surface" tone={tone} size="sm">
          <Title>{tone}</Title>
        </Card>
      ))}
    </div>
  ),
};

/**
 * The three bands around the body. The frame never clips, so the footer link's
 * focus ring is drawn outside the corner and stays whole.
 */
export const Bands: Story = {
  args: { variant: "surface" },
  render: () => (
    <Card
      variant="surface"
      as="article"
      header={<Title>OneDrive</Title>}
      action={
        <button
          type="button"
          className="text-xs text-theme-fg-secondary underline"
        >
          Disconnect
        </button>
      }
      footer={
        <a
          href="#open"
          className="focus-ring block text-xs text-theme-fg-accent"
        >
          Open in OneDrive
        </a>
      }
      bodyClassName="text-xs text-theme-fg-secondary"
    >
      Three folders shared with you.
    </Card>
  ),
};

/** The frame carries the choice for the stylesheet; the radio carries the ARIA. */
export const Selectable: Story = {
  args: { variant: "selectable" },
  render: function SelectableCards() {
    const [value, setValue] = useState("balanced");

    return (
      <div className="flex flex-col gap-3" role="radiogroup">
        {["balanced", "fast"].map((option) => (
          <Card
            key={option}
            variant="selectable"
            as="label"
            control="radio"
            selected={value === option}
            bodyClassName="flex items-start gap-3"
            size="sm"
          >
            <input
              type="radio"
              name="story-mode"
              value={option}
              checked={value === option}
              onChange={() => setValue(option)}
              className="mt-1 size-4 accent-theme-bg-accent"
            />
            <span>
              <Title>{option}</Title>
              <Caption>
                Selected cards keep their fill under the pointer.
              </Caption>
            </span>
          </Card>
        ))}
      </div>
    );
  },
};

/** With no native control in the frame, the frame is the toggle itself. */
export const PressableToggles: Story = {
  args: { variant: "selectable" },
  render: function PressableCards() {
    const [platform, setPlatform] = useState("macOS");

    return (
      <div className="flex gap-3">
        {["macOS", "Windows"].map((option) => (
          <Card
            key={option}
            variant="selectable"
            as="button"
            control="none"
            selected={platform === option}
            onClick={() => setPlatform(option)}
            size="sm"
          >
            <Title>{option}</Title>
          </Card>
        ))}
      </div>
    );
  },
};

/**
 * The disclosure control lives in the header and keeps `aria-expanded`; the
 * frame states `data-expanded`. `unmountOnCollapse` drops the closed body, whose
 * tab stops `Collapse` alone would leave reachable.
 */
export const Expandable: Story = {
  args: { variant: "expandable" },
  render: function ExpandableCard() {
    const [open, setOpen] = useState(false);
    const bodyId = "story-card-body";

    return (
      <Card
        variant="expandable"
        as="article"
        expanded={open}
        unmountOnCollapse
        bodyId={bodyId}
        size="sm"
        header={
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((value) => !value)}
            className="focus-ring-tight flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <DisclosureChevron open={open} size="md" />
            <span className="min-w-0 flex-1">
              <Title>Local sidecar</Title>
              <Caption>Connected</Caption>
            </span>
          </button>
        }
        bodyClassName="border-t border-theme-border text-xs text-theme-fg-secondary"
      >
        Indexes the folders you pick, on this machine only.
      </Card>
    );
  },
};
