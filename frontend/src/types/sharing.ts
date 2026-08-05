/**
 * Types for the sharing feature
 *
 * Note: ShareGrant, CreateShareGrantRequest, OrganizationUser, and OrganizationGroup
 * are generated from OpenAPI schema in @/lib/generated/v1betaApi/v1betaApiSchemas
 * and should be imported directly from there.
 */

import type {
  OrganizationUser,
  OrganizationGroup,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/** Stable values for the synthetic whole-organization sharing target. */
export const ORGANIZATION_SUBJECT_ID = "__organization__";
export const ORGANIZATION_SUBJECT_ID_TYPE = "organization_id";

/**
 * Discriminated union for organization users, groups, and the synthetic
 * whole-organization target
 *
 * Adds a 'type' field to the generated API types so components can distinguish
 * between users and groups when handling them in a unified list.
 */
export type OrganizationMember =
  | (OrganizationUser & { type: "user" })
  | (OrganizationGroup & { type: "group" })
  | {
      id: typeof ORGANIZATION_SUBJECT_ID;
      display_name: string;
      subject_type_id: typeof ORGANIZATION_SUBJECT_ID_TYPE;
      type: "organization";
    };
