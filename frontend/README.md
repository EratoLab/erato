# Chat Frontend

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

1. Set up environment variables:

```bash
# Copy the template environment file
cp .env.template.local .env.local

# Edit .env.local with your configuration
```

2. Install dependencies:

```bash
pnpm install
```

3. Run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Environment Variables

| Variable                   | Description          | Default                  |
| -------------------------- | -------------------- | ------------------------ |
| `NEXT_PUBLIC_API_ROOT_URL` | Backend API root URL | `http://localhost:3001/` |

## Linting and Type Checking

The project uses ESLint with enhanced TypeScript type checking to catch potential issues at development time.

### Available Commands

- `pnpm run lint` - Standard linting using Next.js defaults
- `pnpm run lint:strict` - Strict linting that includes type checking
- `pnpm run lint:fix` - Try to automatically fix linting issues
- `pnpm run typecheck` - Run TypeScript type checking only
- `pnpm run check` - Run both linting and type checking

### Via Just

- `just lint` - Run standard lint
- `just lint-fix` - Run lint with auto-fix
- `just type-check` - Run TypeScript type checking
- `just strict-check` - Run strict linting with type checking

### Enhanced ESLint Rules

The project uses several ESLint plugins and rules to enforce code quality:

#### Type Safety

- Strict promise handling prevents unhandled rejections
- Optional chaining and nullish coalescing operators are preferred
- Unnecessary type assertions and non-null assertions are flagged

#### React Best Practices

- React Hooks rules to prevent common bugs
- Safe use of JSX props and attributes
- Security rules for dangerous HTML and links

#### Accessibility

- Basic accessibility rules for JSX elements
- ARIA attributes validation
- Alt text requirements for images

#### Code Organization

- Import/export organization and sorting
- Consistent type imports
- No duplicate imports

### Common Issues and How to Fix Them

#### Floating Promises

Error: `Promises must be awaited, end with a call to .catch...`

Fix by adding one of the following:

- Add `await` before the function call
- Add `.catch(error => { /* handle error */ })`
- Add `void` operator before the function call if you're intentionally ignoring the promise

```typescript
// Bad
somePromiseFunction();

// Good - Option 1
await somePromiseFunction();

// Good - Option 2
somePromiseFunction().catch((error) => console.error(error));

// Good - Option 3 (only if you intentionally want to ignore the result)
void somePromiseFunction();
```

#### Misused Promises

Error: `Promise-returning function provided to property where a void return was expected`

Fix by creating a handler function:

```typescript
// Bad
<button onClick={somePromiseFunction} />

// Good
<button onClick={() => void somePromiseFunction()} />
// or
<button onClick={async () => await somePromiseFunction()} />
```

#### Unnecessary Type Assertions

Error: `This assertion is unnecessary since it doesn't change the type of the expression.`

Fix by removing the unnecessary type assertion:

```typescript
// Bad
const value = someValue as string;

// Good
const value = someValue; // If already typed as string
```

#### Missing Hook Dependencies

Warning: `React Hook useEffect has a missing dependency: 'someValue'`

Fix by adding the missing dependency:

```typescript
// Bad
useEffect(() => {
  doSomething(someValue);
}, []); // Missing dependency

// Good
useEffect(() => {
  doSomething(someValue);
}, [someValue]); // Properly included dependency
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Custom Theming

This application supports custom theming to allow users to customize the look and feel without rebuilding the application.

### Theme Configuration

The theme system uses a configuration-based approach that can be customized in several ways:

1. **Environment Variables**:

   - `NEXT_PUBLIC_CUSTOMER_NAME`: Name of the customer folder (e.g., "trilux")
   - `NEXT_PUBLIC_THEME_CONFIG_PATH`: Override path to theme.json file
   - `NEXT_PUBLIC_LOGO_PATH`: Path to logo for light mode
   - `NEXT_PUBLIC_LOGO_DARK_PATH`: Path to logo for dark mode

2. **Customer Themes Directory**:

   - Place custom themes in the `/customer-themes/{customer-name}/` directory
   - This directory is git-ignored by default for customer-specific customizations

3. **Default Location**:
   - Fall back to `/themes/custom-theme/theme.json` if no other theme is found

### Custom Theme Structure

Create a theme.json file with the following structure:

```json
{
  "name": "Custom Theme Name",
  "theme": {
    "light": {
      "colors": {
        "background": {
          "primary": "#f8f9ff",
          "secondary": "#eef1fa"
        },
        "foreground": {
          "accent": "#4361ee"
        }
      }
    },
    "dark": {
      "colors": {
        "background": {
          "primary": "#0f172a",
          "secondary": "#1e293b"
        },
        "foreground": {
          "accent": "#60a5fa"
        }
      }
    }
  }
}
```

### Custom Logo Support

You can also provide custom logos for your theme:

1. Place your logo files in the same directory as your theme.json:
   - `/customer-themes/{customer-name}/logo.svg` - Main logo
   - `/customer-themes/{customer-name}/logo-dark.svg` - Dark mode logo (optional)

### Extending the Theme System

The theme system uses a configuration-based approach that can be extended:

1. **Theme Location Configuration**: Modify the `themeConfig.ts` file to change how themes are located and loaded.

2. **Logo Path Resolution**: The `getLogoPath` function in the configuration determines how logo paths are resolved.

### Deployment Options

#### Docker

Mount your custom theme into the container:

```bash
docker run -v ./my-theme:/app/customer-themes/my-customer your-app-image
```

#### Kubernetes

Use a ConfigMap and environment variables:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: custom-theme-config
data:
  theme.json: |
    {
      "name": "Custom Theme",
      "theme": {
        "light": { ... },
        "dark": { ... }
      }
    }
```

Then in your deployment:

```yaml
env:
  - name: NEXT_PUBLIC_CUSTOMER_NAME
    value: "my-customer"
  - name: NEXT_PUBLIC_THEME_CONFIG_PATH
    value: "/config/theme.json"
volumeMounts:
  - name: theme-config
    mountPath: /app/config
volumes:
  - name: theme-config
    configMap:
      name: custom-theme-config
```
