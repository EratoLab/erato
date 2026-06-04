import { generateStaticParamsFor } from "nextra/pages";
import NewWebsiteRedirect from "../../../components/NewWebsiteRedirect.jsx";
import { supportedLocales } from "../../../lib/i18n.js";

/**
 * German locale route handler (/de/*)
 *
 * NOTE: Documentation pages are English-only for the foreseeable future.
 * When users access /de/docs/* routes, they will see English content with
 * the /de/ URL prefix preserved. Only marketing pages (homepage, etc.)
 * are planned for localization.
 */

// Only generate routes for German content
export const dynamicParams = false;

// Generate static params for mdxPath (locale is fixed to "de")
export const generateStaticParams = async () => {
  const locale = "de"; // Hardcoded for this route
  const validLocales = new Set(supportedLocales);
  const mdxParamsGenerator = generateStaticParamsFor("mdxPath");
  const mdxParams = await mdxParamsGenerator();

  const params = [];

  // Always include the root path (empty mdxPath)
  params.push({
    mdxPath: [],
  });

  // Add all other paths, but filter out docs and locale-specific paths
  // NOTE: Documentation is English-only, so we don't generate /de/docs/* routes
  for (const mdxParam of mdxParams) {
    // Skip if it's already the empty path (we added it above)
    if (mdxParam.mdxPath && mdxParam.mdxPath.length > 0) {
      const firstSegment = mdxParam.mdxPath[0];

      // Filter out:
      // 1. Paths that start with a locale code (these are already locale-specific)
      // 2. Docs paths (documentation is English-only)
      if (!validLocales.has(firstSegment) && firstSegment !== "docs") {
        params.push({
          mdxPath: mdxParam.mdxPath,
        });
      }
    }
  }

  // Manually add about page in case Nextra hasn't picked it up yet
  const hasAbout = params.some(
    (p) => p.mdxPath && p.mdxPath.length === 1 && p.mdxPath[0] === "about",
  );
  if (!hasAbout) {
    params.push({
      mdxPath: ["about"],
    });
  }

  return params;
};

export async function generateMetadata(props) {
  const params = await props.params;
  const mdxPath = params.mdxPath || [];

  return {
    title: "Redirecting to the new website - Erato",
    alternates: {
      canonical: `https://eratolabs.com/en/${mdxPath.join("/")}`,
    },
  };
}

export default function Page() {
  return <NewWebsiteRedirect />;
}
