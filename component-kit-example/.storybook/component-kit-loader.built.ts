export const loadComponentKitModule = async (): Promise<void> => {
  await import("virtual:component-kit-built-style");
  const { default: componentKitLoaded } = await import(
    "virtual:component-kit-built-entry"
  );
  await componentKitLoaded;
};
