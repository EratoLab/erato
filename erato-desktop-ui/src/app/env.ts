// The frontend library's `env()` reads these window globals and throws when
// the API root is missing. The desktop UI never dials any of them (the CSP
// blocks every network API), so the values only need to be well-formed.
// `??=` keeps a value the host injected ahead of the bundle.
//
// Imported for its side effect as the first import of the entry, so it runs
// before any library module evaluates.
export function injectFrontendEnv() {
  window.API_ROOT_URL ??= "https://desktop-ui.invalid";
  window.FRONTEND_PLATFORM ??= "common";
  window.FRONTEND_PUBLIC_BASE_PATH ??= "/public/desktop-ui";
  window.COMMON_PUBLIC_BASE_PATH ??= "/public/common";
}

injectFrontendEnv();
