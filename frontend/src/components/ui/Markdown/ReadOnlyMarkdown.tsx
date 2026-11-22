import clsx from "clsx";
import { toText } from "hast-util-to-text";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Root } from "hast";
import type { Components } from "react-markdown";

const remarkPlugins = [remarkGfm];

const components: Components = {
  a: ({ children, href, node: _node, ...props }) => (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-theme-fg-accent underline hover:opacity-80"
    >
      {children}
    </a>
  ),
  blockquote: ({ children, node: _node, ...props }) => (
    <blockquote
      {...props}
      className="mb-3 border-l-4 border-theme-border pl-4 text-theme-fg-secondary last:mb-0"
    >
      {children}
    </blockquote>
  ),
  code: ({ children, className: codeClassName, node: _node, ...props }) => (
    <code
      {...props}
      className={clsx(
        "rounded bg-theme-bg-tertiary px-1 py-0.5 font-mono text-sm",
        codeClassName,
      )}
    >
      {children}
    </code>
  ),
  h1: ({ children, node: _node, ...props }) => (
    <h1 {...props} className="mb-3 mt-5 text-2xl font-bold first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children, node: _node, ...props }) => (
    <h2 {...props} className="mb-3 mt-5 text-xl font-semibold first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children, node: _node, ...props }) => (
    <h3 {...props} className="mb-2 mt-4 text-lg font-semibold first:mt-0">
      {children}
    </h3>
  ),
  li: ({ children, node: _node, ...props }) => (
    <li {...props} className="mb-1 last:mb-0">
      {children}
    </li>
  ),
  ol: ({ children, node: _node, ...props }) => (
    <ol {...props} className="mb-3 list-decimal pl-6 last:mb-0">
      {children}
    </ol>
  ),
  p: ({ children, node: _node, ...props }) => (
    <p {...props} className="mb-3 last:mb-0">
      {children}
    </p>
  ),
  pre: ({ children, node: _node, ...props }) => (
    <pre
      {...props}
      className="mb-3 overflow-x-auto rounded bg-theme-bg-tertiary p-3 last:mb-0"
    >
      {children}
    </pre>
  ),
  ul: ({ children, node: _node, ...props }) => (
    <ul {...props} className="mb-3 list-disc pl-6 last:mb-0">
      {children}
    </ul>
  ),
};

export function ReadOnlyMarkdown({ children }: { children: string }) {
  return (
    <Markdown remarkPlugins={remarkPlugins} components={components}>
      {children}
    </Markdown>
  );
}

// Flatten the parsed content before React creates elements inside a card button.
function rehypeExcerpt() {
  return (tree: Root) => {
    const value = toText(tree).replace(/\s+/g, " ").trim();
    tree.children = [{ type: "text", value }];
  };
}

export function MarkdownExcerpt({ children }: { children: string }) {
  return (
    <Markdown remarkPlugins={remarkPlugins} rehypePlugins={[rehypeExcerpt]}>
      {children}
    </Markdown>
  );
}
