# Customer Component Overrides

This folder is for **local testing** of customer component overrides.

> **Note:** Files in this folder (except `.gitkeep` and `README.md`) are gitignored
> and will not be committed to the repository.

## How to Test Customer Overrides Locally

1. Create your custom component in this folder:

   ```
   src/customer/
     components/
       FileSourceSelectorGrid.tsx   # Your custom implementation
   ```

2. Update `src/config/componentRegistry.ts` to use your component:

   ```typescript
   import { FileSourceSelectorGrid } from "@/customer/components/FileSourceSelectorGrid";

   export const componentRegistry: ComponentRegistry = {
     FileSourceSelector: FileSourceSelectorGrid,
   };
   ```

3. Run the dev server and test your changes.

4. **Important:** Do not commit changes to `componentRegistry.ts` in the main repo.
   The registry should always have `null` values in the main repo.

## Example: Grid Buttons Layout

See `examples/FileSourceSelectorGrid.tsx.example` for a sample implementation
of a two-column button grid layout for the FileSourceSelector.

To use it:

```bash
cp src/customer/examples/FileSourceSelectorGrid.tsx.example \
   src/customer/components/FileSourceSelectorGrid.tsx
```

Then update the registry as described above.

## For Customer Forks

In a customer fork, you would:

1. Create components in this folder (they won't conflict with upstream)
2. Modify `src/config/componentRegistry.ts` to import your components
3. When merging upstream, keep your version of `componentRegistry.ts`:
   ```bash
   git checkout --ours src/config/componentRegistry.ts
   ```
