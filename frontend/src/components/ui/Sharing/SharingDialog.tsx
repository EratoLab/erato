import { t, msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { SegmentedControl } from "@/components/ui/Controls/SegmentedControl";
import { Alert } from "@/components/ui/Feedback/Alert";
import { ModalBase } from "@/components/ui/Modal/ModalBase";
import { toast } from "@/components/ui/Toast";
import { useShareGrants } from "@/hooks/sharing";
import { useAssistantsFeature } from "@/providers/FeatureConfigProvider";

import { ShareGrantsList } from "./ShareGrantsList";
import { SubjectSelector } from "./SubjectSelector";

import type { SubjectTypeFilter } from "./SubjectSelector";
import type { OrganizationMember } from "@/types/sharing";

// Error toasts stay until dismissed: a retry of the same add or removal replaces
// its own, without retracting another grant's failure.
const ADD_TOAST_KEY = "sharing-grants:add";
const removeToastKey = (grantId: string) => `sharing-grants:remove:${grantId}`;

interface SharingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  resourceType: "assistant";
  resourceId: string;
  resourceName: string;
  hasSharepointFiles?: boolean;
}

/**
 * SharingDialog component for managing resource sharing
 *
 * Provides a dialog for adding/removing share grants on a resource
 */
export function SharingDialog({
  isOpen,
  onClose,
  resourceType,
  resourceId,
  resourceName,
  hasSharepointFiles = false,
}: SharingDialogProps) {
  const { _ } = useLingui();
  const { enableEditSharing } = useAssistantsFeature();

  // State for selected subjects
  const [selectedSubjects, setSelectedSubjects] = useState<
    OrganizationMember[]
  >([]);
  const [isAdding, setIsAdding] = useState(false);
  const isAddingRef = useRef(false);
  // A row's Remove button has no busy state of its own, so a second
  // confirmation while the first is in flight is dropped here.
  const removingGrantIds = useRef(new Set<string>());
  const toastKeys = useRef(new Set<string>());
  // State for subject type toggle (users vs groups)
  const [subjectTypeFilter, setSubjectTypeFilter] =
    useState<SubjectTypeFilter>("user");
  const [accessRole, setAccessRole] = useState<"viewer" | "editor">("viewer");

  // Fetch and manage share grants
  const {
    grants,
    isLoading: isLoadingGrants,
    error: grantsError,
    createGrant,
    deleteGrant,
  } = useShareGrants({
    resourceType,
    resourceId,
  });

  // Selected IDs for checkbox state
  const selectedIds = useMemo(
    () => selectedSubjects.map((s) => s.id),
    [selectedSubjects],
  );

  // Clear selections when filter changes to avoid confusion
  // (user wouldn't see what's selected if it's from the other type)
  useEffect(() => {
    setSelectedSubjects([]);
  }, [subjectTypeFilter]);

  // Toggle subject selection
  // Memoized with empty deps: uses setState callback form, stable reference prevents
  // SubjectSelector and all SubjectRow items from re-rendering
  const handleToggleSubject = useCallback((subject: OrganizationMember) => {
    setSelectedSubjects((prev) => {
      const isSelected = prev.some((s) => s.id === subject.id);
      if (isSelected) {
        return prev.filter((s) => s.id !== subject.id);
      }
      return [...prev, subject];
    });
  }, []); // Empty deps: uses setState callback form

  // Handle adding selected subjects
  // Not memoized: only called via button onClick, not passed to memoized children
  const handleAdd = async () => {
    if (selectedSubjects.length === 0 || isAddingRef.current) return;

    isAddingRef.current = true;
    setIsAdding(true);
    toast.dismissKey(ADD_TOAST_KEY);
    toastKeys.current.add(ADD_TOAST_KEY);

    try {
      const subjects = selectedSubjects;
      const results = await Promise.allSettled(
        subjects.map((subject) =>
          createGrant({
            subject_type:
              subject.type === "user"
                ? "user"
                : subject.type === "organization"
                  ? "organization"
                  : // eslint-disable-next-line lingui/no-unlocalized-strings -- API discriminator value
                    "organization_group",
            subject_id_type: subject.subject_type_id,
            subject_id: subject.id,
            role: enableEditSharing ? accessRole : "viewer",
          }),
        ),
      );

      // A duplicate grant is rejected by the backend, so only the failures
      // may stay selected for a retry.
      const grantedIds = new Set(
        subjects
          .filter((_, index) => results[index].status === "fulfilled")
          .map((subject) => subject.id),
      );
      setSelectedSubjects((prev) =>
        prev.filter((subject) => !grantedIds.has(subject.id)),
      );

      const failure = results.find((result) => result.status === "rejected");
      if (failure) {
        console.error("Failed to create share grants:", failure.reason);
        toast.error({
          dedupeKey: ADD_TOAST_KEY,
          title: t({
            id: "sharing.addPeople.error",
            message: "Failed to grant access",
          }),
        });
      } else {
        toast.success({
          dedupeKey: ADD_TOAST_KEY,
          title: t({
            id: "sharing.addPeople.success",
            message: "Access granted successfully",
          }),
        });
      }
    } finally {
      isAddingRef.current = false;
      setIsAdding(false);
    }
  };

  // Handle removing a grant
  // Memoized: passed to ShareGrantsList (memo) which passes to GrantRow (memo) items
  // Prevents re-rendering the entire grants list on parent re-renders
  const handleRemove = useCallback(
    async (grantId: string) => {
      if (removingGrantIds.current.has(grantId)) return;

      removingGrantIds.current.add(grantId);
      const toastKey = removeToastKey(grantId);
      toast.dismissKey(toastKey);
      toastKeys.current.add(toastKey);

      try {
        await deleteGrant(grantId);
        toast.success({
          dedupeKey: toastKey,
          title: t({
            id: "sharing.remove.success",
            message: "Access removed successfully",
          }),
        });
      } catch (error) {
        console.error("Failed to delete share grant:", error);
        toast.error({
          dedupeKey: toastKey,
          title: t({
            id: "sharing.remove.error",
            message: "Failed to remove access",
          }),
        });
      } finally {
        removingGrantIds.current.delete(grantId);
      }
    },
    [deleteGrant],
  );

  // Handle dialog close
  // Not memoized: ModalBase is not memoized, and onClose likely changes on parent re-renders
  const handleClose = () => {
    setSelectedSubjects([]);
    toastKeys.current.forEach((key) => toast.dismissKey(key));
    toastKeys.current.clear();
    setSubjectTypeFilter("user"); // Reset to default
    setAccessRole("viewer");
    onClose();
  };

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={handleClose}
      title={_(
        msg({
          id: "sharing.dialog.title",
          message: `Share "${resourceName}"`,
        }),
      )}
    >
      <div className="space-y-5">
        {hasSharepointFiles ? (
          <Alert type="warning">
            {t({
              id: "sharing.assistant.sharepoint.warning",
              message:
                "This assistant has Sharepoint files attached. Share them with recipients as well so they can access the same files.",
            })}
          </Alert>
        ) : null}
        {grantsError ? (
          <Alert type="error">
            {t({
              id: "sharing.error.loadGrants",
              message: "Failed to load current access",
            })}
          </Alert>
        ) : null}

        {/* Add people section */}
        <div>
          <h3 className="mb-2 text-sm font-medium text-theme-fg-primary">
            {t({ id: "sharing.addPeople.title", message: "Add people" })}
          </h3>

          {/* Toggle between users and groups */}
          <div className="mb-3">
            <SegmentedControl
              options={[
                {
                  value: "user" as const,
                  // Reuse existing translation key
                  label: t({ id: "sharing.section.users", message: "Users" }),
                },
                {
                  value: "group" as const,
                  // Reuse existing translation key
                  label: t({ id: "sharing.section.groups", message: "Groups" }),
                },
              ]}
              value={subjectTypeFilter}
              onChange={setSubjectTypeFilter}
              aria-label={t({
                id: "sharing.filter.ariaLabel",
                message: "Filter by users or groups",
              })}
            />
          </div>

          {enableEditSharing ? (
            <div className="mb-3">
              <SegmentedControl
                options={[
                  {
                    value: "viewer" as const,
                    label: t({
                      id: "sharing.role.read",
                      message: "Read",
                    }),
                  },
                  {
                    value: "editor" as const,
                    label: t({
                      id: "sharing.role.editor",
                      message: "Editor",
                    }),
                  },
                ]}
                value={accessRole}
                onChange={setAccessRole}
                aria-label={t({
                  id: "sharing.role.ariaLabel",
                  message: "Choose access level",
                })}
              />
            </div>
          ) : null}

          <SubjectSelector
            selectedIds={selectedIds}
            onToggleSubject={handleToggleSubject}
            existingGrants={grants ?? []}
            subjectTypeFilter={subjectTypeFilter}
          />
          <div className="mt-3 flex justify-end">
            <Button
              variant="primary"
              onClick={() => {
                void handleAdd();
              }}
              disabled={selectedSubjects.length === 0}
              loading={isAdding}
            >
              {t({ id: "sharing.addPeople.button", message: "Add" })}
            </Button>
          </div>
        </div>

        {/* Current access section - only show when there are grants or loading */}
        {(isLoadingGrants || (grants && grants.length > 0)) && (
          <div>
            <h3 className="mb-2 text-sm font-medium text-theme-fg-primary">
              {t({
                id: "sharing.currentAccess.title",
                message: "Current access",
              })}
            </h3>
            <ShareGrantsList
              grants={grants ?? []}
              onRemove={(grantId: string) => {
                void handleRemove(grantId);
              }}
              canManage={true}
              isLoading={isLoadingGrants}
            />
          </div>
        )}
      </div>
    </ModalBase>
  );
}

// eslint-disable-next-line lingui/no-unlocalized-strings
SharingDialog.displayName = "SharingDialog";
