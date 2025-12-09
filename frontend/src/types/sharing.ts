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

/**
 * Discriminated union for organization users and groups
 *
 * Adds a 'type' field to the generated API types so components can distinguish
 * between users and groups when handling them in a unified list.
 */
export type OrganizationMember =
  | (OrganizationUser & { type: "user" })
  | (OrganizationGroup & { type: "group" });
