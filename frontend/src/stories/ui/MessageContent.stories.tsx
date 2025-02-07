import type { Meta, StoryObj } from '@storybook/react';
import { MessageContent } from '../../components/ui/MessageContent';

const meta = {
  title: 'UI/MessageContent',
  component: MessageContent,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Text content renderer with whitespace handling and word breaking.

## Technical Notes
- Uses \`whitespace-pre-wrap\` for preserving message formatting
- Implements \`break-words\` to handle long strings without overflow
- Memoized to optimize re-renders in chat lists
- Uses semantic \`article\` tag for screen readers

## Styling Considerations
- Inherits theme text colors via CSS variables
- Maintains readable line length via max-width
- Preserves markdown-like whitespace
        `
      }
    }
  },
  argTypes: {
    content: {
      control: 'text',
      description: 'The message text content',
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof MessageContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ShortMessage: Story = {
  args: {
    content: "This is a short message.",
  },
};

export const LongMessage: Story = {
  args: {
    content: "This is a longer message that should wrap to multiple lines. ".repeat(5),
  },
};

export const WithMarkdown: Story = {
  args: {
    content: "This message has **bold** and *italic* text.\n\n- List item 1\n- List item 2",
  },
}; 