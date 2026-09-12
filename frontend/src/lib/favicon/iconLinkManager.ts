const MANAGED_ATTRIBUTE = "data-tab-chat-indicator";

let detachedLinks: HTMLLinkElement[] = [];

const managedLink = (): HTMLLinkElement | null =>
  document.head.querySelector<HTMLLinkElement>(`link[${MANAGED_ATTRIBUTE}]`);

export const applyIconHref = (href: string): void => {
  let link = managedLink();
  if (!link) {
    // Both originals have to go: their `sizes`/`type` let the browser keep
    // choosing the one we did not patch.
    detachedLinks = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
    );
    for (const original of detachedLinks) {
      original.remove();
    }
    link = document.createElement("link");
    link.setAttribute(MANAGED_ATTRIBUTE, "");
    link.setAttribute("rel", "icon");
    link.setAttribute("type", "image/svg+xml");
    document.head.appendChild(link);
  }
  if (link.getAttribute("href") !== href) {
    link.setAttribute("href", href);
  }
};

/** Re-appends the original nodes, so their attributes and theme URL come back intact. */
export const restoreIconLinks = (): void => {
  const link = managedLink();
  if (!link) {
    return;
  }
  link.remove();
  for (const original of detachedLinks) {
    document.head.appendChild(original);
  }
  detachedLinks = [];
};
