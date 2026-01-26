# Customer Component Overrides

This folder contains examples and a workspace for customer-specific component overrides.

> **Full Documentation:** See the [Component Customization](../../site/content/docs/features/component_customization.mdx) guide for complete details.

## Folder Structure

```
/src/customer/
├── README.md              # This file (committed)
├── examples/              # Example implementations (committed)
│   └── FileSourceSelectorGrid.tsx.example
└── components/            # Your custom components (gitignored)
    └── .gitkeep
```

- **`examples/`** - Reference implementations you can copy and modify
- **`components/`** - Your working directory for custom components (gitignored)

## Quick Start

### 1. Copy an Example

```bash
cp src/customer/examples/FileSourceSelectorGrid.tsx.example \
   src/customer/components/FileSourceSelectorGrid.tsx
```

### 2. Register Your Component

Update `src/config/componentRegistry.ts`:

```typescript
// Add import at the top
import { FileSourceSelectorGrid } from "@/customer/components/FileSourceSelectorGrid";

// Set in the registry
export const componentRegistry: ComponentRegistry = {
  AssistantFileSourceSelector: FileSourceSelectorGrid, // Grid for assistant form
  ChatFileSourceSelector: null, // Keep default dropdown for chat
};
```

### 3. Test Locally

Run the dev server and navigate to the assistant form to see your custom component.

## For Customer Forks

In a customer fork:

1. Components in `components/` won't conflict with upstream (gitignored)
2. Modify `componentRegistry.ts` to import your components
3. When merging upstream, keep your version:
   ```bash
   git checkout --ours src/config/componentRegistry.ts
   ```

## Available Override Points

| Registry Key                  | Location       | Description                            |
| ----------------------------- | -------------- | -------------------------------------- |
| `AssistantFileSourceSelector` | Assistant form | File source selector for default files |
| `ChatFileSourceSelector`      | Chat input     | File source selector for chat uploads  |
