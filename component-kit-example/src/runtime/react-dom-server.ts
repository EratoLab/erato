const unsupportedServerRender = () => {
  throw new Error("react-dom/server is not available in component kits");
};

export const renderToPipeableStream = unsupportedServerRender;
export const renderToReadableStream = unsupportedServerRender;
export const renderToStaticMarkup = unsupportedServerRender;
export const renderToString = unsupportedServerRender;
export const resume = unsupportedServerRender;
export const resumeToPipeableStream = unsupportedServerRender;
export const version = "component-kit-runtime";

export default {
  renderToPipeableStream,
  renderToReadableStream,
  renderToStaticMarkup,
  renderToString,
  resume,
  resumeToPipeableStream,
  version,
};
