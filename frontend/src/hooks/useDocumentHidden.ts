import { useEffect, useState } from "react";

/** Whether the page is hidden: another tab, the home screen, a locked phone. */
export const useDocumentHidden = (): boolean => {
  const [hidden, setHidden] = useState(() => document.hidden);

  useEffect(() => {
    const sync = () => {
      setHidden(document.hidden);
    };
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return hidden;
};
