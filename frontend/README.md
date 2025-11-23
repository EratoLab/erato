# Chat Frontend

This is a [Vite](https://vitejs.dev) + [React](https://react.dev) project with TypeScript.

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

You can start editing the app by modifying files in the `src/` directory. The page auto-updates as you edit files.

## Environment Variables

The application supports environment variables with a dual-source system: variables can be provided either as Vite environment variables (prefixed with `VITE_`) or injected from the backend via window globals.

| Variable                 | Description                 | Window Fallback               | Required |
| ------------------------ | --------------------------- | ----------------------------- | -------- |
| `VITE_API_ROOT_URL`      | Backend API root URL        | `window.API_ROOT_URL`         | Yes      |
| `VITE_CUSTOMER_NAME`     | Customer name for theming   | `window.THEME_CUSTOMER_NAME`  | No       |
| `VITE_THEME_PATH`        | Custom theme path           | `window.THEME_PATH`           | No       |
| `VITE_THEME_CONFIG_PATH` | Path to theme configuration | `window.THEME_CONFIG_PATH`    | No       |
| `VITE_LOGO_PATH`         | Path to logo (light mode)   | `window.THEME_LOGO_PATH`      | No       |
| `VITE_LOGO_DARK_PATH`    | Path to logo (dark mode)    | `window.THEME_LOGO_DARK_PATH` | No       |

### Usage

You can set these variables in several ways:

1. **Environment file**: Create a `.env` or `.env.local` file in the frontend directory:

```bash
VITE_API_ROOT_URL=http://localhost:4180/api/
VITE_CUSTOMER_NAME=my-customer
```

2. **Backend injection**: The backend can inject these values via window globals (see `frontend_environment.rs`).

3. **Build time**: Set them when building:

```bash
VITE_API_ROOT_URL=https://api.example.com pnpm build
```

## Linting and Type Checking

The project uses ESLint with enhanced TypeScript type checking to catch potential issues at development time.

### Available Commands

- `pnpm run lint` - Standard linting using ESLint configuration
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

To learn more about the technologies used in this project:

- [Vite Documentation](https://vitejs.dev/guide/) - learn about Vite's features and configuration
- [React Documentation](https://react.dev/learn) - learn React concepts and patterns
- [TypeScript Handbook](https://www.typescriptlang.org/docs/) - learn TypeScript

## Deployment

This application is designed to be deployed as a static site that communicates with a backend API. The backend can inject configuration via window globals, making it suitable for containerized deployments.

## Custom Theming

This application supports custom theming to allow users to customize the look and feel without rebuilding the application.

### Theme Configuration

The theme system uses a configuration-based approach that can be customized in several ways:

1. **Environment Variables**:

   - `VITE_CUSTOMER_NAME`: Name of the customer folder (e.g., "trilux")
   - `VITE_THEME_CONFIG_PATH`: Override path to theme.json file
   - `VITE_LOGO_PATH`: Path to logo for light mode
   - `VITE_LOGO_DARK_PATH`: Path to logo for dark mode
   - `VITE_ASSISTANT_AVATAR_PATH`: Path to assistant avatar image

2. **Customer Themes Directory**:

   - Place custom themes in the `/custom-theme/{customer-name}/` directory
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
   - `/custom-theme/{customer-name}/logo.svg` - Main logo
   - `/custom-theme/{customer-name}/logo-dark.svg` - Dark mode logo (optional)

### Custom Assistant Avatar

You can customize the assistant's avatar image to match your branding:

1. **Using Customer Theme Directory**:

   Place your avatar file in the same directory as your theme.json:

   - `/custom-theme/{customer-name}/assistant-avatar.svg` - Assistant avatar image

   The avatar will be automatically detected and loaded when available.

2. **Using Environment Variables**:

   Override the assistant avatar path completely:

   ```bash
   VITE_ASSISTANT_AVATAR_PATH=/path/to/custom-assistant-avatar.svg
   ```

3. **Supported File Formats**:

   - SVG (recommended for scalability)
   - PNG, JPG, or other image formats supported by browsers

4. **Fallback Behavior**:

   If no custom avatar is provided, the assistant will display with a colored circle containing the letter "A" (styled using the theme's `avatar.assistant` colors from theme.json).

### Extending the Theme System

The theme system uses a configuration-based approach that can be extended:

1. **Theme Location Configuration**: Modify the `themeConfig.ts` file to change how themes are located and loaded.

2. **Logo Path Resolution**: The `getLogoPath` function in the configuration determines how logo paths are resolved.

### Deployment Options

#### Docker

Mount your custom theme into the container:

```bash
docker run -v ./my-theme:/app/custom-theme/my-customer your-app-image
```

Your theme directory structure should include:

```
my-theme/
├── theme.json              # Theme configuration
├── logo.svg                # Application logo (light mode)
├── logo-dark.svg           # Application logo (dark mode, optional)
└── assistant-avatar.svg    # Assistant avatar (optional)
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
  - name: VITE_CUSTOMER_NAME
    value: "my-customer"
  - name: VITE_THEME_CONFIG_PATH
    value: "/config/theme.json"
volumeMounts:
  - name: theme-config
    mountPath: /app/config
volumes:
  - name: theme-config
    configMap:
      name: custom-theme-config
```
