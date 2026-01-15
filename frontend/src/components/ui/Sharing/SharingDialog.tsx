import { t, msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useState, useCallback, useMemo, useEffect } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { SegmentedControl } from "@/components/ui/Controls/SegmentedControl";
import { Alert } from "@/components/ui/Feedback/Alert";
import { ModalBase } from "@/components/ui/Modal/ModalBase";
import { useShareGrants, useOrganizationMembers } from "@/hooks/sharing";

import { ShareGrantsList } from "./ShareGrantsList";
import { SubjectSelector } from "./SubjectSelector";

import type { SubjectTypeFilter } from "./SubjectSelector";
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
  const { _ } = useLingui();

  const [selectedSubjects, setSelectedSubjects] = useState<
    OrganizationMember[]
  >([]);
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [subjectTypeFilter, setSubjectTypeFilter] =
    useState<SubjectTypeFilter>("user");

  const {
    members: availableSubjects,
    isLoading: isLoadingMembers,
    error: membersError,
  } = useOrganizationMembers();

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

  const selectedIds = useMemo(
    () => selectedSubjects.map((s) => s.id),
    [selectedSubjects],
  );

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(""), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  useEffect(() => {
    setSelectedSubjects([]);
  }, [subjectTypeFilter]);

  const handleToggleSubject = useCallback((subject: OrganizationMember) => {
    setSelectedSubjects((prev) => {
      const isSelected = prev.some((s) => s.id === subject.id);
      if (isSelected) {
        return prev.filter((s) => s.id !== subject.id);
      }
      return [...prev, subject];
    });
  }, []);

  const handleAdd = async () => {
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
    } catch (error) {
      console.error("Failed to create share grants:", error);
      setErrorMessage(
        t({
          id: "sharing.addPeople.error",
          message: "Failed to grant access",
        }),
      );
    }
  };

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

  const handleClose = () => {
    setSelectedSubjects([]);
    setSuccessMessage("");
    setErrorMessage("");
    setSubjectTypeFilter("user");
    onClose();
  };

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={handleClose}
      title={_(
        msg({
          id: "sharing.dialog.title",
          message: `Share ${resourceName}`,
        }),
      )}
    >
      <div className="space-y-5">
        {successMessage ? <Alert type="success">{successMessage}</Alert> : null}
        {errorMessage ? <Alert type="error">{errorMessage}</Alert> : null}
        {membersError ? (
          <Alert type="error">
            {t({
              id: "sharing.error.loadMembers",
              message: "Failed to load users and groups",
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

        <div>
          <h3 className="mb-2 text-sm font-medium text-theme-fg-primary">
            {t({ id: "sharing.addPeople.title", message: "Add people" })}
          </h3>

          <div className="mb-3">
            <SegmentedControl
              options={[
                {
                  value: "user" as const,
                  label: t({ id: "sharing.section.users", message: "Users" }),
                },
                {
                  value: "group" as const,
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

          <SubjectSelector
            availableSubjects={availableSubjects}
            selectedIds={selectedIds}
            onToggleSubject={handleToggleSubject}
            isLoading={isLoadingMembers}
            existingGrants={grants ?? []}
            subjectTypeFilter={subjectTypeFilter}
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
