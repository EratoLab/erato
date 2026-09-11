# Tab rail retune harness

Measures tab corners in a real browser under the shipped `open-webui-like`
theme. Every tab's corner is
`max(0px, var(--tab-rail-radius, var(--theme-radius-control)) - var(--tab-rail-track-padding))`,
and the theme's live rule `[data-ui="tab-rail"] { --theme-radius-control: var(--theme-radius-pill) }`
re-declares the token on the rail's own hook, so it survives `ModalBase`'s
portal and reaches every rail — the two `SharingDialog` segmented controls,
the text-size control, both settings rails, the markdown/preview strip and a
page rail. That rule is what pills them: deleting only it from the loaded
sheet drops the markdown/preview tab to the theme's 0.75rem token corner,
while deleting the interim `[data-ui="modal-shell"] [role="tablist"][aria-orientation]`
rule changes nothing. Inside `ModalBase` and under `page-shell` the interim
and page-shell rules match as well, so those controls remove both before the
base corner shows.

Every reading is paired with the same element after the responsible rule is
deleted through the CSSOM, and the deleted count is asserted, so a selector
the theme no longer contains cannot leave a control silently unbroken. The
`0` vs `0px` case injects `--tab-rail-track-padding: 0` on a segmented rail:
the track's own padding accepts it, but the corner's `max()` becomes invalid
and every segment goes square; the same rule written `0px` keeps the full
pill.

The theme pack is not in this repository, and `frontend/public/public/` is not
tracked. Copy it into the Storybook static directory first:

```bash
mkdir -p frontend/public/public/common/custom-theme
cp -R <erato-subscription-content>/themes/open-webui-like \
  frontend/public/public/common/custom-theme/
```

Start Storybook from `frontend/`:

```bash
VITE_API_ROOT_URL=http://localhost:4180/api/ VITE_CUSTOMER_NAME=open-webui-like \
  pnpm exec storybook dev -p 6199 --no-open --ci
```

Run the harness from `e2e-tests/`:

```bash
pnpm exec playwright test -c storybook-tabrail-retune/playwright.config.ts
```

Set `STORYBOOK_URL` for a Storybook on another port. Without
`VITE_CUSTOMER_NAME` every case fails on the missing `link[data-theme-styles]`
rather than on a corner.
