/**
 * German content metadata
 *
 * NOTE: Documentation pages are English-only for the foreseeable future.
 * This _meta.js only includes marketing pages (homepage, etc.) that are localized.
 * The "docs" entry is intentionally omitted since there are no German docs pages.
 */
export default {
  index: {
    title: "Startseite",
    type: "page",
    display: "hidden",
    theme: {
      sidebar: false,
      toc: false,
      layout: "full",
    },
  },
  about: {
    title: "Über uns",
    type: "page",
    theme: {
      sidebar: false,
      toc: false,
      layout: "full",
    },
  },
  // docs entry intentionally omitted - documentation is English-only
};
