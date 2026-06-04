import { Layout } from "nextra-theme-docs";
import { Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import CustomFooter from "../../components/CustomFooter.jsx";
import CustomNavbar from "../../components/CustomNavbar.jsx";
import SearchConfig from "../../components/SearchConfig.jsx";

const navbar = <CustomNavbar />;
const footer = <CustomFooter />;

export default async function DocsLayout({ children }) {
  return (
    <>
      <Head backgroundColor={{ light: "#f7f6f3" }} />
      <SearchConfig />
      <Layout
        navbar={navbar}
        pageMap={await getPageMap()}
        docsRepositoryBase="https://github.com/EratoLab/erato/tree/main/site"
        footer={footer}
      >
        {children}
      </Layout>
    </>
  );
}
