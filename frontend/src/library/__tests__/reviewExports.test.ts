import { describe, expect, it } from "vitest";

import * as library from "..";

// The desktop review window imports these by name from the library. The icons
// otherwise arrive only through the generated registry's star export, which
// can drop a name without a type error anywhere.
describe("library exports for list and review windows", () => {
  it.each([
    "Checkbox",
    "SelectableRow",
    "SELECTABLE_ROW_CHECKBOX_SELECTOR",
    "ProgressBar",
    "DetailFields",
    "ListToolbar",
    "ListGroupHeading",
    "ActionBar",
    "MasterDetailLayout",
    "DetailPane",
    "DetailPaneSection",
    "ComponentSlot",
    "componentRegistry",
    "CheckIcon",
    "WarningIcon",
    "FolderIcon",
    "ChevronLeftIcon",
    "ChevronRightIcon",
    "OpenNewWindowIcon",
    "PageIcon",
  ])("exports %s", (name) => {
    expect(library[name as keyof typeof library]).toBeDefined();
  });
});
