import { generateStaticParamsFor, importPage } from "nextra/pages";
import { useMDXComponents as getMDXComponents } from "../../mdx-components";

// Force static generation for all non-locale routes
export const dynamicParams = false;

export const generateStaticParams = async () => {
  const mdxParamsGenerator = generateStaticParamsFor("mdxPath");
  const allParams = await mdxParamsGenerator();

  console.log("All params:", allParams);
  // Filter out docs paths (they're handled by /docs/[[...slug]])
  // and locale paths (they're handled by /[locale]/[[...mdxPath]])
  const filteredParams = allParams.filter((param) => {
    const path = param.mdxPath || [];
    // Exclude docs paths
    if (path.length > 0 && path[0] === "docs") {
      return false;
    }
    // Exclude locale paths (de, etc.)
    if (path.length > 0 && ["de"].includes(path[0])) {
      return false;
    }
    return true;
  });

  // Explicitly add /about route if not already present
  // This ensures Next.js knows this route (not [locale]) handles /about
  const hasAbout = filteredParams.some(
    (p) => p.mdxPath && p.mdxPath.length === 1 && p.mdxPath[0] === "about",
  );
  if (!hasAbout) {
    filteredParams.push({ mdxPath: ["about"] });
  }

  return filteredParams;
};

export async function generateMetadata(props) {
  const params = await props.params;
  const mdxPath = params.mdxPath || [];
  const { metadata } = await importPage(mdxPath);
  return {
    ...metadata,
    title: `${metadata.title} - Erato`,
  };
}

const Wrapper = getMDXComponents().wrapper;

export default async function Page(props) {
  const params = await props.params;
  const mdxPath = params.mdxPath || [];
  const result = await importPage(mdxPath);
  const { default: MDXContent, toc, metadata } = result;

  // Skip wrapper for full-layout pages
  if (
    metadata.filePath === "content/index.mdx" ||
    metadata.filePath === "content/about.mdx" ||
    metadata.filePath === "content/imprint.mdx"
  ) {
    return <MDXContent {...props} params={params} />;
  }

  return (
    <Wrapper toc={toc} metadata={metadata}>
      <MDXContent {...props} params={params} />
    </Wrapper>
  );
}
