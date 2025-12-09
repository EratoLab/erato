import { t } from "@lingui/core/macro";
import { useState, useCallback, useMemo } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { ModalBase } from "@/components/ui/Modal/ModalBase";
import { useShareGrants, useOrganizationMembers } from "@/hooks/sharing";

import { ShareGrantsList } from "./ShareGrantsList";
import { SubjectSelector } from "./SubjectSelector";

import type { OrganizationMember } from "@/types/sharing";

interface SharingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  resourceType: "assistant";
  resourceId: string;
  resourceName: string;
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
}: SharingDialogProps) {
  // State for selected subjects
  const [selectedSubjects, setSelectedSubjects] = useState<
    OrganizationMember[]
  >([]);
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Fetch organization members (users and groups)
  const {
    members: availableSubjects,
    isLoading: isLoadingMembers,
    error: membersError,
  } = useOrganizationMembers();

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

  // Toggle subject selection
  // Empty deps: uses setState callback form, doesn't depend on external state
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
  const handleAdd = useCallback(async () => {
    if (selectedSubjects.length === 0) return;

    setSuccessMessage("");
    setErrorMessage("");

    try {
      // Create share grants for all selected subjects
      await Promise.all(
        selectedSubjects.map((subject) =>
          createGrant({
            subject_type:
              // eslint-disable-next-line lingui/no-unlocalized-strings
              subject.type === "user" ? "user" : "organization_group",
            subject_id_type: subject.subject_type_id,
            subject_id: subject.id,

            role: "viewer",
          }),
        ),
      );

      setSuccessMessage(
        t({
          id: "sharing.addPeople.success",
          message: "Access granted successfully",
        }),
      );
      setSelectedSubjects([]);

      // Clear success message after a delay
      setTimeout(() => {
        setSuccessMessage("");
      }, 3000);
    } catch (error) {
      console.error("Failed to create share grants:", error);
      setErrorMessage(
        t({
          id: "sharing.addPeople.error",
          message: "Failed to grant access",
        }),
      );
    }
  }, [selectedSubjects, createGrant]);

  // Handle removing a grant
  const handleRemove = useCallback(
    async (grantId: string) => {
      setSuccessMessage("");
      setErrorMessage("");

      try {
        await deleteGrant(grantId);
        setSuccessMessage(
          t({
            id: "sharing.remove.success",
            message: "Access removed successfully",
          }),
        );

        // Clear success message after a delay
        setTimeout(() => {
          setSuccessMessage("");
        }, 3000);
      } catch (error) {
        console.error("Failed to delete share grant:", error);
        setErrorMessage(
          t({
            id: "sharing.remove.error",
            message: "Failed to remove access",
          }),
        );
      }
    },
    [deleteGrant],
  );

  // Handle dialog close
  const handleClose = useCallback(() => {
    setSelectedSubjects([]);
    setSuccessMessage("");
    setErrorMessage("");
    onClose();
  }, [onClose]);

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={handleClose}
      title={t({
        id: "sharing.dialog.title",
        message: "Share {resourceName}",
        values: { resourceName },
      })}
    >
      <div className="space-y-5">
        {/* Success/Error alerts */}
        {successMessage && <Alert type="success">{successMessage}</Alert>}
        {errorMessage && <Alert type="error">{errorMessage}</Alert>}
        {membersError && (
          <Alert type="error">
            {t({
              id: "sharing.error.loadMembers",
              message: "Failed to load users and groups",
            })}
          </Alert>
        )}
        {grantsError && (
          <Alert type="error">
            {t({
              id: "sharing.error.loadGrants",
              message: "Failed to load current access",
            })}
          </Alert>
        )}

        {/* Add people section */}
        <div>
          <h3 className="mb-2 text-sm font-medium text-theme-fg-primary">
            {t({ id: "sharing.addPeople.title", message: "Add people" })}
          </h3>
          <SubjectSelector
            availableSubjects={availableSubjects}
            selectedIds={selectedIds}
            onToggleSubject={handleToggleSubject}
            isLoading={isLoadingMembers}
            existingGrants={grants ?? []}
          />
          <Button
            variant="primary"
            onClick={() => {
              void handleAdd();
            }}
            className="mt-3"
            disabled={selectedSubjects.length === 0}
          >
            {t({ id: "sharing.addPeople.button", message: "Add" })}
          </Button>
        </div>

        {/* Current access section */}
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
            availableSubjects={availableSubjects}
          />
        </div>
      </div>
    </ModalBase>
  );
}

// eslint-disable-next-line lingui/no-unlocalized-strings
SharingDialog.displayName = "SharingDialog";
