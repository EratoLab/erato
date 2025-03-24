import { withDynamicParams } from "next-static-utils";

import ChatPage from "./ChatPage";

export const generateStaticParams = withDynamicParams();

export default function Page() {
  return <ChatPage />;
}
