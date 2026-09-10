# Attachment chip retune harness

Measures the attachment chip's corner in a real browser under the shipped
`open-webui-like` theme, which declares `--attachment-tile-radius` on the email
thread card. A chip inside one has to take the pill corner and a chip outside
one has to stay on the base corner: the chip reads that variable and never
declares it, and a default on `.attachment-tile-geometry` would shadow the
card's value while leaving one of the two halves passing.

The theme pack is not in this repository. Copy it into the Storybook static
directory first — `frontend/public/custom-theme/` and everything under
`frontend/public/public/` are gitignored:

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
pnpm exec playwright test -c storybook-chip-retune/playwright.config.ts
```

Set `STORYBOOK_URL` to point at a Storybook on another port. Without
`VITE_CUSTOMER_NAME` the stylesheet never loads and every case fails on the
missing `link[data-theme-styles]` rather than on a corner.
