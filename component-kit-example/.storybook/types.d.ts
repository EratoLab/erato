declare module "virtual:component-kit-built-entry" {
  const componentKitLoaded: Promise<unknown>;
  export default componentKitLoaded;
}
declare module "virtual:component-kit-built-style" {}
declare module "virtual:component-kit-mode-loader" {
  export const loadComponentKitModule: () => Promise<void>;
}
