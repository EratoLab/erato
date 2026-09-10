# Attachment chip retune harness

Measures the attachment chip's corner in a real browser under the shipped
`open-webui-like` theme, which declares `--attachment-tile-radius` on the email
thread card. A chip inside one takes the pill corner; a chip outside one stays
on the base corner. Both halves are needed: a default on
`.attachment-tile-geometry` would break only the first.

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
pnpm exec playwright test -c storybook-chip-retune/playwright.config.ts
```

Set `STORYBOOK_URL` for a Storybook on another port. Without
`VITE_CUSTOMER_NAME` every case fails on the missing `link[data-theme-styles]`
rather than on a corner.
