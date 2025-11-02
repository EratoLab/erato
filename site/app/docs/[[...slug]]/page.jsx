import { generateStaticParamsFor, importPage } from "nextra/pages";
import { useMDXComponents as getMDXComponents } from "../../../mdx-components";

/**
 * Explicit /docs route handler to prevent /docs from being matched as a locale.
 * This route has higher priority than [locale] routes.
 */

// Force static generation
export const dynamicParams = false;

export const generateStaticParams = async () => {
  const mdxParamsGenerator = generateStaticParamsFor("mdxPath");
  const allParams = await mdxParamsGenerator();
  
  // Filter to only include paths that start with "docs"
  return allParams
    .filter(param => {
      const path = param.mdxPath || [];
      return path.length > 0 && path[0] === "docs";
    })
    .map(param => ({
      slug: param.mdxPath.slice(1), // Remove "docs" prefix since it's in the route
    }));
};

export async function generateMetadata(props) {
  const params = await props.params;
  const slug = params.slug || [];
  const mdxPath = ["docs", ...slug];
  
  const { metadata } = await importPage(mdxPath);
  return {
    ...metadata,
    title: `${metadata.title} - Erato`,
  };
}

const Wrapper = getMDXComponents().wrapper;

export default async function Page(props) {
  const params = await props.params;
  const slug = params.slug || [];
  const mdxPath = ["docs", ...slug];
  
  const result = await importPage(mdxPath);
  const { default: MDXContent, toc, metadata } = result;

  return (
    <Wrapper toc={toc} metadata={metadata}>
      <MDXContent {...props} params={params} />
    </Wrapper>
  );
}

