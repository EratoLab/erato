# UI Components — Conventions

## Success / confirmation feedback

### The canonical pattern: transient label swap

All success feedback in the UI uses a **~2 s transient label/icon swap**.  
Use the shared `useTransientLabel` hook from `@/hooks/ui/useTransientLabel`:

```tsx
import { useTransientLabel } from "@/hooks/ui/useTransientLabel";
import { t } from "@lingui/core/macro";

function CopyButton({ text }: { text: string }) {
  const {
    isActive: isCopied,
    trigger: triggerCopied,
    srAnnouncement,
  } = useTransientLabel({ announcement: t`Copied to clipboard` });

  return (
    <>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          triggerCopied();
        }}
      >
        {isCopied ? "Copied!" : "Copy"}
      </button>
      {/* sr-only live region — include whenever the visible change is icon-only */}
      <p role="status" className="sr-only">
        {srAnnouncement}
      </p>
    </>
  );
}
```

**Why not ad-hoc `useState` + `setTimeout`?**  
The hook handles timer cleanup on unmount (no leak), restarts the timer on
rapid re-triggers, and optionally surfaces a `role="status"` announcement for
screen readers that would otherwise miss a silent icon swap.

**Default delay: 2000 ms.** Pass `{ delay: N }` to override.

### Accessibility

Supply the `announcement` option whenever the only visible change is an icon
swap (no text label change). For buttons that already change their text label
(e.g. "Copy" → "Copied!"), the announcement is optional but harmless.

Render `srAnnouncement` in a `role="status"` / `aria-live="polite"` sr-only
element. The live region is empty when inactive, so it only fires once on
trigger — not on every render.

---

## What NOT to use for success feedback

| Idiom                                         | Use for                                                                                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Toasts** (`toast.success` / `<Toaster>`)    | Auth/permission flows, session decisions ("You switched conversation", Graph sign-in prompts). **Not** for micro-actions like copy or form submission confirmations. |
| **Persistent resolved row** (removed 2026-07) | Was used by `ActionConfirmationCard`; removed because callers now close the card on resolution and show transient feedback on the trigger button instead.            |

Errors continue to use **sticky toast** (`toast.error`) or **inline `<Alert
type="error">`** depending on scope (global vs. component-local).
