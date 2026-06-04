import { generateStaticParamsFor } from "nextra/pages";
import NewWebsiteRedirect from "../../components/NewWebsiteRedirect.jsx";

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

  return {
    title: "Redirecting to the new website - Erato",
    alternates: {
      canonical: `https://eratolabs.com/${mdxPath.join("/")}`,
    },
  };
}

export default function Page() {
  return <NewWebsiteRedirect />;
}
