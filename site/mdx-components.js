import { useMDXComponents as getThemeComponents } from "nextra-theme-docs"; // nextra-theme-blog or your custom theme
import { removeLinks } from "nextra/remove-links";
import { SkipNavContent } from "nextra/components";
import { Sidebar } from "./components/docs/Sidebar";

// Get the default MDX components
const themeComponents = getThemeComponents();

// Merge components
export function useMDXComponents(components) {
  return {
    ...themeComponents,
    wrapper: ({
      toc,
      children,
      metadata,
      bottomContent,
      ...props
    }) => {
      const cleanToC = toc.map((item) => ({
        ...item,
        value: removeLinks(item.value),
      }));

      return (
        <div
          className="x:mx-auto x:flex x:max-w-(--nextra-content-width)"
          {...props}
        >
          <Sidebar toc={cleanToC} />
          <main
              className="x:w-full x:min-w-0 x:break-words x:min-h-[calc(100vh-var(--nextra-navbar-height))] x:text-slate-700 x:dark:text-slate-200 x:pb-8 x:px-4 x:pt-4 x:md:px-12"
              data-pagefind-body={metadata?.searchable !== false || undefined}
            >
              <SkipNavContent />
              {children}
              {bottomContent}
            </main>
        </div>
      );
    },
    ...components,
  };
}
