import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

interface EmailAddress {
  displayName: string;
  emailAddress: string;
}

export interface OutlookMailItemData {
  subject: string;
  from: EmailAddress | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  dateTimeCreated: Date | null;
  conversationId: string | null;
  internetMessageId: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  isLoadingBody: boolean;
}

interface OutlookMailItemContextValue {
  mailItem: OutlookMailItemData | null;
  isLoading: boolean;
  refresh: () => void;
}

const OutlookMailItemContext = createContext<OutlookMailItemContextValue>({
  mailItem: null,
  isLoading: true,
  refresh: () => {},
});

function parseRecipients(
  recipients: Office.EmailAddressDetails[] | undefined,
): EmailAddress[] {
  if (!recipients) {
    return [];
  }

  return recipients.map((recipient) => ({
    displayName: recipient.displayName,
    emailAddress: recipient.emailAddress,
  }));
}

function isMessageRead(
  item: Office.MessageRead | Office.MessageCompose,
): item is Office.MessageRead {
  return typeof (item as Office.MessageRead).subject === "string";
}

function readMailItemSync(item: Office.MessageRead): OutlookMailItemData {
  const from = item.from
    ? {
        displayName: item.from.displayName,
        emailAddress: item.from.emailAddress,
      }
    : null;

  return {
    subject: item.subject ?? "",
    from,
    to: parseRecipients(item.to),
    cc: parseRecipients(item.cc),
    dateTimeCreated: item.dateTimeCreated ?? null,
    conversationId: item.conversationId ?? null,
    internetMessageId: item.internetMessageId ?? null,
    bodyText: null,
    bodyHtml: null,
    isLoadingBody: true,
  };
}

function readMailItemCompose(
  item: Office.MessageCompose,
  setMailItem: React.Dispatch<React.SetStateAction<OutlookMailItemData | null>>,
) {
  setMailItem({
    subject: "",
    from: null,
    to: [],
    cc: [],
    dateTimeCreated: null,
    conversationId: item.conversationId ?? null,
    internetMessageId: null,
    bodyText: null,
    bodyHtml: null,
    isLoadingBody: true,
  });

  item.subject.getAsync((result) => {
    if (result.status === Office.AsyncResultStatus.Succeeded) {
      setMailItem((previous) =>
        previous ? { ...previous, subject: result.value } : previous,
      );
    }
  });

  item.to.getAsync((result) => {
    if (result.status === Office.AsyncResultStatus.Succeeded) {
      setMailItem((previous) =>
        previous
          ? { ...previous, to: parseRecipients(result.value) }
          : previous,
      );
    }
  });

  item.cc.getAsync((result) => {
    if (result.status === Office.AsyncResultStatus.Succeeded) {
      setMailItem((previous) =>
        previous
          ? { ...previous, cc: parseRecipients(result.value) }
          : previous,
      );
    }
  });

  let textDone = false;
  let htmlDone = false;

  const checkDone = () => {
    if (textDone && htmlDone) {
      setMailItem((previous) =>
        previous ? { ...previous, isLoadingBody: false } : previous,
      );
    }
  };

  item.body.getAsync(Office.CoercionType.Text, (result) => {
    if (result.status === Office.AsyncResultStatus.Succeeded) {
      setMailItem((previous) =>
        previous ? { ...previous, bodyText: result.value } : previous,
      );
    }

    textDone = true;
    checkDone();
  });

  item.body.getAsync(Office.CoercionType.Html, (result) => {
    if (result.status === Office.AsyncResultStatus.Succeeded) {
      setMailItem((previous) =>
        previous ? { ...previous, bodyHtml: result.value } : previous,
      );
    }

    htmlDone = true;
    checkDone();
  });
}

export function useOutlookMailItem() {
  return useContext(OutlookMailItemContext);
}

export function OutlookMailItemProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mailItem, setMailItem] = useState<OutlookMailItemData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((previous) => previous + 1);
  }, []);

  useEffect(() => {
    const item = Office.context.mailbox.item as
      | Office.MessageRead
      | Office.MessageCompose
      | null;

    if (!item) {
      setMailItem(null);
      setIsLoading(false);
      return;
    }

    if (isMessageRead(item)) {
      setMailItem(readMailItemSync(item));
      setIsLoading(false);

      let textDone = false;
      let htmlDone = false;

      const checkDone = () => {
        if (textDone && htmlDone) {
          setMailItem((previous) =>
            previous ? { ...previous, isLoadingBody: false } : previous,
          );
        }
      };

      item.body.getAsync(Office.CoercionType.Text, (result) => {
        if (result.status === Office.AsyncResultStatus.Succeeded) {
          setMailItem((previous) =>
            previous ? { ...previous, bodyText: result.value } : previous,
          );
        } else {
          console.warn("Failed to read email body:", result.error?.message);
        }

        textDone = true;
        checkDone();
      });

      item.body.getAsync(Office.CoercionType.Html, (result) => {
        if (result.status === Office.AsyncResultStatus.Succeeded) {
          setMailItem((previous) =>
            previous ? { ...previous, bodyHtml: result.value } : previous,
          );
        } else {
          console.warn(
            "Failed to read email HTML body:",
            result.error?.message,
          );
        }

        htmlDone = true;
        checkDone();
      });
    } else {
      readMailItemCompose(item, setMailItem);
      setIsLoading(false);
    }
  }, [refreshKey]);

  useEffect(() => {
    const mailbox = Office.context.mailbox;

    function onItemChanged() {
      setRefreshKey((previous) => previous + 1);
    }

    try {
      mailbox.addHandlerAsync(
        Office.EventType.ItemChanged,
        onItemChanged,
        (result) => {
          if (result.status !== Office.AsyncResultStatus.Succeeded) {
            console.warn(
              "Failed to register ItemChanged handler:",
              result.error?.message,
            );
          }
        },
      );
    } catch (error) {
      console.warn("ItemChanged not supported:", error);
    }

    return () => {
      try {
        mailbox.removeHandlerAsync(Office.EventType.ItemChanged, () => {});
      } catch {
        // Best-effort cleanup.
      }
    };
  }, []);

  return (
    <OutlookMailItemContext.Provider value={{ mailItem, isLoading, refresh }}>
      {children}
    </OutlookMailItemContext.Provider>
  );
}
