import type { Meta, StoryObj } from '@storybook/react';
import { ChatMessage } from '../../components/ui/ChatMessage';
import { ChatMessageFactory } from './mockData';
import { expect } from '@storybook/jest';
import { within } from '@storybook/testing-library';

const meta = {
  title: 'CHAT/ChatMessage/Tests',
  component: ChatMessage,
  parameters: {
    layout: 'centered',
    a11y: {
      config: {
        rules: [
          {
            // Ensure proper ARIA roles
            id: 'aria-roles',
            enabled: true
          }
        ]
      }
    }
  },
} satisfies Meta<typeof ChatMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AccessibilityChecks: Story = {
  args: {
    message: ChatMessageFactory.samples.assistant,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    
    // Check if message content is visible
    const messageContent = await canvas.findByText(ChatMessageFactory.samples.assistant.content);
    expect(messageContent).toBeInTheDocument();
    
    // Check if role attributes are present
    const article = canvas.getByRole('log');
    expect(article).toBeInTheDocument();
    
    // Check if timestamp is accessible
    const timestamp = canvas.getByTitle(ChatMessageFactory.samples.assistant.createdAt.toLocaleString());
    expect(timestamp).toBeInTheDocument();
  }
};

export const InteractionTest: Story = {
  args: {
    message: ChatMessageFactory.samples.longMessage,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    
    // Verify message container is properly sized
    const container = canvas.getByRole('log');
    const messageWrapper = container.querySelector('div');
    const styles = window.getComputedStyle(messageWrapper!);
    
    // Add minimum width check
    expect(styles.minWidth).toBe('280px');
    expect(styles.maxWidth).toBe('768px');
    
    // Verify avatar presence using a more specific selector
    const avatar = canvas.getByText('A', { selector: '[aria-hidden="true"]' });
    expect(avatar).toBeInTheDocument();
    
    // Verify text wrapping
    const messageText = canvas.getByText(ChatMessageFactory.samples.longMessage.content);
    const textStyles = window.getComputedStyle(messageText);
    expect(textStyles.whiteSpace).toBe('pre-wrap');
  }
};

export const ResponsiveTest: Story = {
  args: {
    message: ChatMessageFactory.samples.assistant,
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
    chromatic: { viewports: [320, 768] }
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const container = canvas.getByRole('log');
    
    // Verify responsive behavior - container should be full width
    expect(container.className).toContain('w-full');
  }
}; 