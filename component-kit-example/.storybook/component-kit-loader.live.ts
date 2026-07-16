export const loadComponentKitModule = async (): Promise<void> => {
  await import("../src/style.css");
  await import("../src/index");
};
