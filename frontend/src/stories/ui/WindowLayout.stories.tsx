import { ActionBar } from "../../components/ui/Container/ActionBar";
import {
  DetailPane,
  DetailPaneSection,
} from "../../components/ui/Container/DetailPane";
import { ListGroupHeading } from "../../components/ui/Container/ListGroupHeading";
import { ListToolbar } from "../../components/ui/Container/ListToolbar";
import { MasterDetailLayout } from "../../components/ui/Container/MasterDetailLayout";
import { PageHeader } from "../../components/ui/Container/PageHeader";
import { Button } from "../../components/ui/Controls/Button";
import { Checkbox } from "../../components/ui/Controls/Checkbox";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/WindowLayout",
  component: MasterDetailLayout,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: `
The pieces of a small app window, used by the desktop app and open to any
surface with the same shape. Themes reach them through \`data-ui\`:

\`\`\`css
[data-ui="list-toolbar"] { … }
[data-ui="list-group-heading"] { … }
[data-ui="action-bar"] { … }
[data-ui="master-detail"] { … }
[data-ui="detail-pane"] { … }
\`\`\`
        `,
      },
    },
  },
} satisfies Meta<typeof MasterDetailLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

const Frame = ({ detail }: { detail: boolean }) => (
  <div className="flex h-[32rem] flex-col">
    <PageHeader
      density="window"
      title="Choose what to share"
      subtitle={
        <>
          <strong>The web app</strong> searched this device and found 20 items.
        </>
      }
    />
    <ListToolbar>
      <Checkbox checked={false} onCheckedChange={() => {}} label="Select all" />
    </ListToolbar>
    <MasterDetailLayout
      list={<ListGroupHeading>Search results</ListGroupHeading>}
      detail={
        detail ? (
          <DetailPane
            title="One item"
            titleId="story-pane"
            onClose={() => {}}
            closeLabel="Close"
          >
            <DetailPaneSection title="Body" hint="view only">
              The text of the item.
            </DetailPaneSection>
          </DetailPane>
        ) : undefined
      }
    />
    <ActionBar status={<span>Checked</span>}>
      <Button variant="secondary">Decline</Button>
      <Button variant="primary">Share</Button>
    </ActionBar>
  </div>
);

export const ListOnly: Story = {
  args: { list: null },
  render: () => <Frame detail={false} />,
};

export const DetailOpen: Story = {
  args: { list: null },
  render: () => <Frame detail />,
};
