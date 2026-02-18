import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { UserPreferencesDialog } from "@/components/ui/Settings/UserPreferencesDialog";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Meta, StoryObj } from "@storybook/react";

const UserPreferencesDialogStory = ({
  userProfile,
}: {
  userProfile?: UserProfile;
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-theme-bg-secondary p-6">
        <Button variant="secondary" onClick={() => setIsOpen(true)}>
          Open Preferences
        </Button>
        <UserPreferencesDialog
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          userProfile={userProfile}
        />
      </div>
    </QueryClientProvider>
  );
};

const meta = {
  title: "UI/UserPreferencesDialog",
  component: UserPreferencesDialog,
  args: {
    isOpen: true,
    onClose: () => {},
  },
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof UserPreferencesDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const mockUserProfile: UserProfile = {
  id: "user-1",
  groups: ["engineering"],
  organization_group_ids: ["org-group-1"],
  preferred_language: "en",
  name: "Max Mustermann",
  email: "max.mustermann@example.com",
  preference_nickname: "Max",
  preference_job_title: "Product Manager",
  preference_assistant_custom_instructions:
    "Prefer concise bullet points and highlight risks first.",
  preference_assistant_additional_information:
    "I work with enterprise customers in regulated industries.",
};

export const Empty: Story = {
  render: () => <UserPreferencesDialogStory />,
};

export const WithExistingPreferences: Story = {
  render: () => <UserPreferencesDialogStory userProfile={mockUserProfile} />,
};
