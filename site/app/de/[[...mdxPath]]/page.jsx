import { generateStaticParamsFor } from "nextra/pages";
import { useMDXComponents as getMDXComponents } from "../../../mdx-components";
import { resolveContentWithFallback } from "../../../lib/content-resolver.js";
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
  const locale = "de"; // Hardcoded for this route
  const mdxPath = params.mdxPath || [];

  try {
    const result = await resolveContentWithFallback(mdxPath, locale);
    return {
      ...result.metadata,
      title: `${result.metadata.title} - Erato`,
    };
  } catch (error) {
    // If content resolution fails, return a basic metadata object
    console.error(
      `[i18n] Failed to generate metadata for locale ${locale}, path [${mdxPath.join(", ")}]:`,
      error,
    );
    return {
      title: "Erato",
    };
  }
}

const Wrapper = getMDXComponents().wrapper;

export default async function Page(props) {
  const params = await props.params;
  const locale = "de"; // Hardcoded for this route
  const mdxPath = params.mdxPath || [];

  try {
    const result = await resolveContentWithFallback(mdxPath, locale);
    const { default: MDXContent, toc, metadata, actualLocale } = result;

    // Skip wrapper for full-layout pages (index and about)
    const isFullLayoutPage =
      metadata.filePath === `content/${locale}/index.mdx` ||
      metadata.filePath === `content/${locale}/about.mdx` ||
      (actualLocale === "en" &&
        (metadata.filePath === "content/index.mdx" ||
          metadata.filePath === "content/about.mdx") &&
        locale === "de");

    if (isFullLayoutPage) {
      return <MDXContent {...props} params={params} />;
    }

    return (
      <Wrapper toc={toc} metadata={metadata}>
        <MDXContent {...props} params={params} />
      </Wrapper>
    );
  } catch (error) {
    // If content resolution fails, try to render a fallback
    console.error(
      `[i18n] Failed to load content for locale ${locale}, path [${mdxPath.join(", ")}]:`,
      error,
    );
    // Return a simple error message or redirect
    return (
      <div className="p-8">
        <h1>Content not found</h1>
        <p>Unable to load content for this page.</p>
      </div>
    );
  }
}
