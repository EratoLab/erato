import nextra from "nextra";
import remarkConfigMetadata from "./scripts/remark-config-metadata.mjs";

// Set up Nextra with its configuration
const withNextra = nextra({
  mdxOptions: { remarkPlugins: [remarkConfigMetadata] },
});

// Export the final Next.js config with Nextra included
export default withNextra({
  // ... Add regular Next.js options here
  output: "export",
  images: {
    unoptimized: true, // mandatory, otherwise won't export
  },
});
