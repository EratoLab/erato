import { t } from "@lingui/core/macro";
import { memo, useMemo } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { MessageTimestamp } from "@/components/ui/Message/MessageTimestamp";

import type { ShareGrant } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { OrganizationMember } from "@/types/sharing";

interface ShareGrantsListProps {
  grants: ShareGrant[];
  onRemove: (grantId: string) => void;
  canManage: boolean;
  isLoading?: boolean;
  className?: string;
  availableSubjects: OrganizationMember[];
}

/**
 * ShareGrantsList component for displaying current share grants
 *
 * Shows a list of users/groups who have access to the resource
 */
export const ShareGrantsList = memo<ShareGrantsListProps>(
  ({
    grants,
    onRemove,
    canManage,
    isLoading = false,
    className = "",
    availableSubjects,
  }) => {
    // Create a lookup map for subject display names
    const subjectLookup = useMemo(() => {
      const map = new Map<string, string>();
      availableSubjects.forEach((subject) => {
        map.set(subject.id, subject.display_name);
      });
      return map;
    }, [availableSubjects]);

    // Loading state
    if (isLoading) {
      return (
        <div className={`py-8 text-center ${className}`}>
          <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
          <p className="text-sm text-theme-fg-secondary">
            {t({ id: "sharing.loading", message: "Loading..." })}
          </p>
        </div>
      );
    }

    // Empty state
    if (grants.length === 0) {
      return (
        <div className={`py-8 text-center ${className}`}>
          <p className="text-sm text-theme-fg-muted">
            {t({
              id: "sharing.currentAccess.empty",
              message: "No one has access yet",
            })}
          </p>
        </div>
      );
    }

    return (
      <div
        className={`divide-y divide-theme-border rounded-lg border border-theme-border ${className}`}
      >
        {grants.map((grant) => (
          <GrantRow
            key={grant.id}
            grant={grant}
            onRemove={onRemove}
            canManage={canManage}
            subjectLookup={subjectLookup}
          />
        ))}
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
ShareGrantsList.displayName = "ShareGrantsList";

// Individual grant row component
interface GrantRowProps {
  grant: ShareGrant;
  onRemove: (grantId: string) => void;
  canManage: boolean;
  subjectLookup: Map<string, string>;
}

const GrantRow = memo<GrantRowProps>(
  ({ grant, onRemove, canManage, subjectLookup }) => {
    // Look up display name from the lookup map, fallback to ID if not found
    const displayName = subjectLookup.get(grant.subject_id) ?? grant.subject_id;
    const isGroup = grant.subject_type === "organization_group";

    return (
      <div className="flex items-start gap-3 px-4 py-3 text-sm sm:items-center">
        {/* Subject info */}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-theme-fg-primary">
              {displayName}
            </span>
            <span className="shrink-0 rounded-full bg-theme-bg-secondary px-2 py-0.5 text-xs text-theme-fg-secondary">
              {isGroup
                ? t({ id: "sharing.type.group", message: "Group" })
                : t({ id: "sharing.type.user", message: "User" })}
            </span>
            <span className="shrink-0 rounded-full bg-theme-bg-secondary px-2 py-0.5 text-xs text-theme-fg-secondary">
              {t({ id: "sharing.role.viewer", message: "Viewer" })}
            </span>
          </div>
          <div className="text-xs text-theme-fg-muted">
            {t({ id: "sharing.currentAccess.created", message: "Added" })}{" "}
            <MessageTimestamp createdAt={new Date(grant.created_at)} />
          </div>
        </div>

        {/* Remove button */}
        {canManage && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => onRemove(grant.id)}
            confirmAction={true}
            confirmTitle={t({
              id: "sharing.remove.confirm.title",
              message: "Remove Access",
            })}
            confirmMessage={t({
              id: "sharing.remove.confirm.message",
              message:
                "Are you sure you want to remove access for this user/group?",
            })}
          >
            {t({ id: "sharing.remove.button", message: "Remove" })}
          </Button>
        )}
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
GrantRow.displayName = "GrantRow";
