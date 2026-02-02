import { MessageContent } from "../../components/ui/Message/MessageContent";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Meta, StoryObj } from "@storybook/react";

// Helper to convert string to ContentPart[]
const textContent = (text: string): ContentPart[] => [
  { content_type: "text", text },
];

const meta = {
  title: "UI/MessageContent",
  component: MessageContent,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: `
Text content renderer with markdown support, syntax highlighting, and raw/formatted toggle.

## Features
- Full markdown rendering with react-markdown
- Syntax highlighting for code blocks
- GitHub Flavored Markdown (GFM) support
- Raw markdown view toggle
- Streaming support with visual cursor
- XSS-safe rendering

## Technical Notes
- Uses \`react-markdown\` with \`remark-gfm\` for parsing
- Code highlighting via \`react-syntax-highlighter\`
- Memoized to optimize re-renders in chat lists
- Handles incomplete markdown during streaming
- Raw view shows original markdown syntax
        `,
      },
    },
  },
  argTypes: {
    content: {
      control: "text",
      description: "The message text content",
    },
    isStreaming: {
      control: "boolean",
      description: "Whether the content is being streamed",
    },
    showRaw: {
      control: "boolean",
      description: "Toggle between raw markdown and formatted view",
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof MessageContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  args: {
    content: textContent(
      "This is a simple message without any markdown formatting.",
    ),
  },
};

export const WithMarkdown: Story = {
  args: {
    content: textContent(
      "This message has **bold** and *italic* text.\n\n- List item 1\n- List item 2",
    ),
  },
};

export const RawMarkdownView: Story = {
  args: {
    content: textContent(`# Markdown Example

This shows **bold**, *italic*, and \`inline code\`.

## Code Block

\`\`\`javascript
function hello() {
  console.log("Hello, World!");
}
\`\`\`

### Features
- Lists work great
- Tables are supported
- Links: [OpenAI](https://openai.com)
`),
    showRaw: true,
  },
};

export const FormattedMarkdownView: Story = {
  args: {
    content: textContent(`# Markdown Example

This shows **bold**, *italic*, and \`inline code\`.

## Code Block

\`\`\`javascript
function hello() {
  console.log("Hello, World!");
}
\`\`\`

### Features
- Lists work great
- Tables are supported
- Links: [OpenAI](https://openai.com)
`),
    showRaw: false,
  },
};

export const StreamingWithCursor: Story = {
  args: {
    content: textContent("This is a message being streamed in real-time"),
    isStreaming: true,
  },
};

export const IncompleteMarkdown: Story = {
  args: {
    content: textContent("This has an incomplete **bold marker"),
    isStreaming: true,
  },
};

export const CodeBlock: Story = {
  args: {
    content: textContent(`Here's a Python example:

\`\`\`python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

# Calculate the 10th Fibonacci number
print(fibonacci(10))
\`\`\`

And some inline \`code\` as well.`),
  },
};

export const Table: Story = {
  args: {
    content: textContent(`## Comparison Table

| Feature | React | Vue | Angular |
|---------|-------|-----|---------|
| Learning Curve | Moderate | Easy | Steep |
| Performance | Fast | Fast | Fast |
| Community | Large | Growing | Large |
| TypeScript | Optional | Optional | Built-in |
`),
  },
};

export const ThemedCodeBlocks: Story = {
  args: {
    content: textContent(`## Code with Theme-Aware Styling

Light mode uses a light syntax theme, dark mode uses a dark theme:

\`\`\`javascript
// This code block adapts to your theme
function greet(name) {
  console.log(\`Hello, \${name}!\`);
  return name.toUpperCase();
}
\`\`\`

Inline \`code\` also uses theme colors.
`),
  },
  parameters: {
    docs: {
      description: {
        story:
          "Code blocks automatically switch between light and dark syntax highlighting based on the active theme.",
      },
    },
  },
};

export const ComplexMarkdown: Story = {
  args: {
    content: textContent(`# Complex Markdown Example

This demonstrates various **markdown features** working together.

## Lists and Code

1. First item with \`inline code\`
2. Second item with a [link](https://example.com)
3. Third item with **bold** and *italic*

### Nested List
- Parent item
  - Child with \`code\`
  - Another child
    - Deep nesting

## Code Examples

\`\`\`typescript
interface User {
  id: string;
  name: string;
  email?: string;
}

const greetUser = (user: User): string => {
  return \`Hello, \${user.name}!\`;
};
\`\`\`

## Blockquote

> "The best way to predict the future is to invent it."
> — Alan Kay

## Task List

- [x] Implement markdown rendering
- [x] Add syntax highlighting
- [x] Support GFM features
- [ ] Add mermaid diagrams
- [ ] Implement math equations

---

*Thank you for reading!*
`),
  },
};

export const Footnotes: Story = {
  args: {
    content: textContent(`# Footnotes example

First sentence with single footnote.[^1]

[^1]: http://example.com/example1

Second sentence with multiple footnotes.[^2][^3]

[^2]: http://example.com/example2
[^3]: http://example.com/example3

Another sentence without footnotes.

Second sentence with text-named footnote.[^footnote]

[^footnote]: http://example.com/example-footnote

Another sentence without footnotes.
`),
  },
};

export const ResolvedFileLinksInMarkdown: Story = {
  args: {
    content: textContent(
      [
        "Here are the documents you asked for:",
        "",
        "- [Quarterly Report](erato-file://file_123?page=4)",
        "- [Design Spec](erato-file://file_abc#page=2)",
        "",
        "These should resolve to the file download URLs with the page anchors.",
        "",
        "Raw autolink example:",
        "erato-file://file_123?page=7",
      ].join("\n"),
    ),
    fileDownloadUrls: {
      file_123: "https://files.example.com/downloads/quarterly-report.pdf",
      file_abc: "https://files.example.com/downloads/design-spec.pdf",
    },
  },
  parameters: {
    docs: {
      description: {
        story:
          "Demonstrates how `erato-file://` markdown links are resolved using the file download map.",
      },
    },
  },
};
