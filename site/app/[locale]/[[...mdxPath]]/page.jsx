import { generateStaticParamsFor } from "nextra/pages";
import { useMDXComponents as getMDXComponents } from "../../../mdx-components";
import { resolveContentWithFallback } from "../../../lib/content-resolver.js";
import { getValidLocale, supportedLocales } from "../../../lib/i18n.js";
import { notFound } from "next/navigation";

/**
 * Locale-prefixed route handler for non-default locales (e.g., /de/*)
 *
 * NOTE: Documentation pages are English-only for the foreseeable future.
 * When users access /de/docs/* routes, they will see English content with
 * the /de/ URL prefix preserved. Only marketing pages (homepage, etc.)
 * are planned for localization.
 */

// Only generate routes for valid locales - don't match invalid ones
export const dynamicParams = false;

// Generate static params for locale and mdxPath
export const generateStaticParams = async () => {
  const locales = ["de"]; // Only generate non-default locales here
  const mdxParamsGenerator = generateStaticParamsFor("mdxPath");
  const mdxParams = await mdxParamsGenerator();

  const params = [];
  for (const locale of locales) {
    // Always include the root path (empty mdxPath) for each locale
    params.push({
      locale,
      mdxPath: [],
    });

    // Add all other paths, but filter out locale-specific paths
    // (e.g., don't include paths that start with a locale code since we're generating /de/* routes)
    for (const mdxParam of mdxParams) {
      // Skip if it's already the empty path (we added it above)
      if (mdxParam.mdxPath && mdxParam.mdxPath.length > 0) {
        // Filter out paths that start with a locale code (these are already locale-specific)
        const firstSegment = mdxParam.mdxPath[0];
        if (!supportedLocales.includes(firstSegment)) {
          params.push({
            locale,
            mdxPath: mdxParam.mdxPath,
          });
        }
      }
    }
  }

  return params;
};

export async function generateMetadata(props) {
  const params = await props.params;
  const localeParam = params.locale;

  // With dynamicParams = false, only valid locales should reach here
  // But we'll still validate to be safe
  if (!supportedLocales.includes(localeParam)) {
    return {
      title: "Erato",
    };
  }

  const locale = getValidLocale(localeParam);
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
  const localeParam = params.locale;

  // With dynamicParams = false, only valid locales should reach here
  // But we'll still validate to be safe
  if (!supportedLocales.includes(localeParam)) {
    // This shouldn't happen with dynamicParams = false, but handle it gracefully
    notFound();
  }

  const locale = getValidLocale(localeParam);
  const mdxPath = params.mdxPath || [];

  try {
    const result = await resolveContentWithFallback(mdxPath, locale);
    const { default: MDXContent, toc, metadata, actualLocale } = result;

    // Skip wrapper for index pages
    const isIndexPage =
      metadata.filePath === `content/${locale}/index.mdx` ||
      (actualLocale === "en" &&
        metadata.filePath === "content/index.mdx" &&
        locale === "de");

    if (isIndexPage) {
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
