/**
 * Mock data for sharing components stories
 */

import type { ShareGrant } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { OrganizationMember } from "@/types/sharing";

/**
 * Mock organization users
 */
export const mockUsers: OrganizationMember[] = [
  {
    id: "user-001",
    display_name: "Alice Johnson",
    subject_type_id: "organization_user_id",
    type: "user",
  },
  {
    id: "user-002",
    display_name: "Bob Smith",
    subject_type_id: "organization_user_id",
    type: "user",
  },
  {
    id: "user-003",
    display_name: "Carol Williams",
    subject_type_id: "organization_user_id",
    type: "user",
  },
  {
    id: "user-004",
    display_name: "David Brown",
    subject_type_id: "organization_user_id",
    type: "user",
  },
  {
    id: "user-005",
    display_name: "Emma Davis",
    subject_type_id: "organization_user_id",
    type: "user",
  },
];

/**
 * Mock organization groups
 */
export const mockGroups: OrganizationMember[] = [
  {
    id: "group-001",
    display_name: "Engineering Team",
    subject_type_id: "organization_group_id",
    type: "group",
  },
  {
    id: "group-002",
    display_name: "Product Management",
    subject_type_id: "organization_group_id",
    type: "group",
  },
  {
    id: "group-003",
    display_name: "Design Team",
    subject_type_id: "organization_group_id",
    type: "group",
  },
];

/**
 * Combined organization members (users + groups)
 */
export const mockOrganizationMembers: OrganizationMember[] = [
  ...mockUsers,
  ...mockGroups,
];

/**
 * Mock share grants
 */
export const mockShareGrants: ShareGrant[] = [
  {
    id: "grant-001",
    resource_type: "assistant",
    resource_id: "assistant-123",
    subject_type: "user",
    subject_id_type: "organization_user_id",
    subject_id: "user-001",
    role: "viewer",
    created_at: "2025-12-01T10:00:00Z",
    updated_at: "2025-12-01T10:00:00Z",
  },
  {
    id: "grant-002",
    resource_type: "assistant",
    resource_id: "assistant-123",
    subject_type: "organization_group",
    subject_id_type: "organization_group_id",
    subject_id: "group-001",
    role: "viewer",
    created_at: "2025-12-02T14:30:00Z",
    updated_at: "2025-12-02T14:30:00Z",
  },
  {
    id: "grant-003",
    resource_type: "assistant",
    resource_id: "assistant-123",
    subject_type: "user",
    subject_id_type: "organization_user_id",
    subject_id: "user-003",
    role: "viewer",
    created_at: "2025-12-03T09:15:00Z",
    updated_at: "2025-12-03T09:15:00Z",
  },
];
