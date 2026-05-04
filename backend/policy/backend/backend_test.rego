package backend_test

import data.backend

# Test data
user_1_id := "user-1"
user_2_id := "user-2"
user_3_id := "user-3"
chat_1_id := "chat-1"
assistant_1_id := "assistant-1"
assistant_2_id := "assistant-2"
file_upload_1_id := "file-upload-1"
file_upload_2_id := "file-upload-2"
file_upload_3_id := "file-upload-3"
file_upload_4_id := "file-upload-4"
chat_provider_1_id := "mock-llm"
chat_provider_2_id := "premium-llm"
mcp_server_1_id := "public-mcp"
mcp_server_2_id := "premium-mcp"
facet_1_id := "web_search"
facet_2_id := "image_generation"

resource_attributes := {
	"chat": {
		chat_1_id: {
			"id": chat_1_id,
			"owner_id": user_1_id,
			"archived_at": null,
		},
	},
	"assistant": {
		assistant_1_id: {
			"id": assistant_1_id,
			"owner_id": user_1_id,
		},
		assistant_2_id: {
			"id": assistant_2_id,
			"owner_id": user_2_id,
		},
	},
	"file_upload": {
		file_upload_1_id: {
			"id": file_upload_1_id,
			"owner_id": user_1_id,
			"linked_chat_ids": [],
			"linked_assistant_ids": [],
		},
		file_upload_2_id: {
			"id": file_upload_2_id,
			"owner_id": user_3_id,
			"linked_chat_ids": [chat_1_id],
			"linked_assistant_ids": [],
		},
		file_upload_3_id: {
			"id": file_upload_3_id,
			"owner_id": user_3_id,
			"linked_chat_ids": [],
			"linked_assistant_ids": [assistant_2_id],
		},
		file_upload_4_id: {
			"id": file_upload_4_id,
			"owner_id": user_1_id,
			"linked_chat_ids": [],
			"linked_assistant_ids": [assistant_1_id],
		},
	},
	"chat_provider": {
		chat_provider_1_id: {
			"id": chat_provider_1_id,
		},
		chat_provider_2_id: {
			"id": chat_provider_2_id,
		},
	},
	"mcp_server": {
		mcp_server_1_id: {
			"id": mcp_server_1_id,
		},
		mcp_server_2_id: {
			"id": mcp_server_2_id,
		},
	},
	"facet": {
		facet_1_id: {
			"id": facet_1_id,
		},
		facet_2_id: {
			"id": facet_2_id,
		},
	},
}

empty_config_permissions := {
	"chat_provider": [],
	"mcp_server": [],
	"facet": [],
}

group_config_permissions := {
	"chat_provider": [{
		"rule_type": "allow-for-group-members",
		"resource_ids": [chat_provider_2_id],
		"groups": ["premium"],
	}],
	"mcp_server": [{
		"rule_type": "allow-for-group-members",
		"resource_ids": [mcp_server_2_id],
		"groups": ["premium"],
	}],
	"facet": [{
		"rule_type": "allow-for-group-members",
		"resource_ids": [facet_2_id],
		"groups": ["premium"],
	}],
}

# Share grants data - assistant_1 is shared with user_2 as viewer
share_grants := [
	{
		"id": "grant-1",
		"resource_type": "assistant",
		"resource_id": assistant_1_id,
		"subject_type": "user",
		"subject_id_type": "id",
		"subject_id": user_2_id,
		"role": "viewer",
	},
]

share_links := [
	{
		"id": "share-link-1",
		"resource_type": "chat",
		"resource_id": chat_1_id,
		"enabled": true,
	},
]

chat_sharing_enabled_config := {
	"chat_sharing": {
		"enabled": true,
	},
}

chat_sharing_disabled_config := {
	"chat_sharing": {
		"enabled": false,
	},
}

# Organization group IDs for testing
org_group_1_id := "org-group-1"
org_group_2_id := "org-group-2"

# Share grants data with organization_group - assistant_2 is shared with org-group-1
share_grants_with_org_group := [
	{
		"id": "grant-2",
		"resource_type": "assistant",
		"resource_id": assistant_2_id,
		"subject_type": "organization_group",
		"subject_id_type": "organization_group_id",
		"subject_id": org_group_1_id,
		"role": "viewer",
	},
]

# A user can read their own chat.
test_user_can_read_own_chat if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "chat",
		"resource_id": chat_1_id,
		"action": "read",
	} with data.resource_attributes as resource_attributes
}

# A user cannot read another user's chat.
test_user_cannot_read_other_users_chat if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_2_id,
		"resource_kind": "chat",
		"resource_id": chat_1_id,
		"action": "read",
	} with data.resource_attributes as resource_attributes
		with data.share_links as []
		with data.config as chat_sharing_enabled_config
}

test_user_can_read_shared_chat_when_feature_enabled if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_2_id,
		"resource_kind": "chat",
		"resource_id": chat_1_id,
		"action": "read",
	} with data.resource_attributes as resource_attributes
		with data.share_links as share_links
		with data.config as chat_sharing_enabled_config
}

test_user_cannot_read_shared_chat_when_feature_disabled if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_2_id,
		"resource_kind": "chat",
		"resource_id": chat_1_id,
		"action": "read",
	} with data.resource_attributes as resource_attributes
		with data.share_links as share_links
		with data.config as chat_sharing_disabled_config
}

test_user_cannot_read_shared_chat_when_share_link_disabled if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_2_id,
		"resource_kind": "chat",
		"resource_id": chat_1_id,
		"action": "read",
	} with data.resource_attributes as resource_attributes
		with data.share_links as [{
			"id": "share-link-1",
			"resource_type": "chat",
			"resource_id": chat_1_id,
			"enabled": false,
		}]
		with data.config as chat_sharing_enabled_config
}

test_owner_can_share_own_chat if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "chat",
		"resource_id": chat_1_id,
		"action": "share",
	} with data.resource_attributes as resource_attributes
}

test_user_can_read_linked_file_via_shared_chat if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_2_id,
		"resource_kind": "file_upload",
		"resource_id": file_upload_2_id,
		"action": "read",
	} with data.resource_attributes as resource_attributes
		with data.share_links as share_links
		with data.config as chat_sharing_enabled_config
}

# A logged-in user can create a chat.
test_logged_in_user_can_create_chat if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "chat_singleton",
		"resource_id": "__singleton__",
		"action": "create",
	}
}

# A not-logged-in user cannot create a chat.
test_anonymous_user_cannot_create_chat if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": "__not_logged_in__",
		"resource_kind": "chat_singleton",
		"resource_id": "__singleton__",
		"action": "create",
	}
}

# A user can submit a message to their own chat.
test_user_can_submit_message_to_own_chat if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "chat",
		"resource_id": chat_1_id,
		"action": "submit_message",
	} with data.resource_attributes as resource_attributes
}

# A user cannot submit a message to another user's chat.
test_user_cannot_submit_message_to_other_users_chat if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_2_id,
		"resource_kind": "chat",
		"resource_id": chat_1_id,
		"action": "submit_message",
	} with data.resource_attributes as resource_attributes
}

# --- Assistant Ownership Tests ---

# An owner can read their own assistant.
test_owner_can_read_own_assistant if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "assistant",
		"resource_id": assistant_1_id,
		"action": "read",
	} with data.resource_attributes as resource_attributes
}

# An owner can update their own assistant.
test_owner_can_update_own_assistant if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "assistant",
		"resource_id": assistant_1_id,
		"action": "update",
	} with data.resource_attributes as resource_attributes
}

# An owner can share their own assistant.
test_owner_can_share_own_assistant if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "assistant",
		"resource_id": assistant_1_id,
		"action": "share",
	} with data.resource_attributes as resource_attributes
}

# A user cannot read another user's assistant without sharing.
test_user_cannot_read_other_users_assistant if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_2_id,
		"resource_kind": "assistant",
		"resource_id": assistant_1_id,
		"action": "read",
	} with data.resource_attributes as resource_attributes
		with data.share_grants as []
}

# A user cannot update another user's assistant.
test_user_cannot_update_other_users_assistant if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_2_id,
		"resource_kind": "assistant",
		"resource_id": assistant_1_id,
		"action": "update",
	} with data.resource_attributes as resource_attributes
		with data.share_grants as share_grants
}

# A user cannot share another user's assistant.
test_user_cannot_share_other_users_assistant if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_2_id,
		"resource_kind": "assistant",
		"resource_id": assistant_1_id,
		"action": "share",
	} with data.resource_attributes as resource_attributes
}

# --- Assistant Sharing Tests ---

# A viewer (via share_grant) can read the shared assistant.
test_viewer_can_read_shared_assistant if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_2_id,
		"resource_kind": "assistant",
		"resource_id": assistant_1_id,
		"action": "read",
	} with data.resource_attributes as resource_attributes
		with data.share_grants as share_grants
}

# A viewer cannot update the shared assistant.
test_viewer_cannot_update_shared_assistant if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_2_id,
		"resource_kind": "assistant",
		"resource_id": assistant_1_id,
		"action": "update",
	} with data.resource_attributes as resource_attributes
		with data.share_grants as share_grants
}

# A viewer cannot share the shared assistant.
test_viewer_cannot_share_shared_assistant if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_2_id,
		"resource_kind": "assistant",
		"resource_id": assistant_1_id,
		"action": "share",
	} with data.resource_attributes as resource_attributes
		with data.share_grants as share_grants
}

# --- File Upload Ownership Tests ---

# An owner can read their own file upload.
test_owner_can_read_own_file_upload if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "file_upload",
		"resource_id": file_upload_1_id,
		"action": "read",
	} with data.resource_attributes as resource_attributes
}

# A non-owner cannot read another user's file upload.
test_user_cannot_read_other_users_file_upload if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_2_id,
		"resource_kind": "file_upload",
		"resource_id": file_upload_1_id,
		"action": "read",
	} with data.resource_attributes as resource_attributes
}

# A user can update their own file upload.
test_owner_can_update_own_file_upload if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "file_upload",
		"resource_id": file_upload_1_id,
		"action": "update",
	} with data.resource_attributes as resource_attributes
}

# A user cannot update another user's file upload.
test_user_cannot_update_other_users_file_upload if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_2_id,
		"resource_kind": "file_upload",
		"resource_id": file_upload_1_id,
		"action": "update",
	} with data.resource_attributes as resource_attributes
}

# A user can read a file upload if they can read one of its linked chats.
test_user_can_read_file_upload_via_linked_chat if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "file_upload",
		"resource_id": file_upload_2_id,
		"action": "read",
	} with data.resource_attributes as resource_attributes
}

# A user can read a file upload if they own one of its linked assistants.
test_assistant_owner_can_read_file_upload_via_linked_assistant if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_2_id,
		"resource_kind": "file_upload",
		"resource_id": file_upload_3_id,
		"action": "read",
	} with data.resource_attributes as resource_attributes
}

# A viewer (via assistant user share_grant) can read a linked file upload.
test_assistant_viewer_can_read_file_upload_via_user_share_grant if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_2_id,
		"resource_kind": "file_upload",
		"resource_id": file_upload_4_id,
		"action": "read",
	} with data.resource_attributes as resource_attributes
		with data.share_grants as share_grants
}

# A user in a shared organization_group can read a linked file upload.
test_user_in_org_group_can_read_file_upload_via_org_group_share_grant if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_3_id,
		"resource_kind": "file_upload",
		"resource_id": file_upload_3_id,
		"action": "read",
		"organization_group_ids": [org_group_1_id],
	} with data.resource_attributes as resource_attributes
		with data.share_grants as share_grants_with_org_group
}

# A user without access to the linked assistant cannot read the linked file upload.
test_user_cannot_read_file_upload_via_unshared_linked_assistant if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_3_id,
		"resource_kind": "file_upload",
		"resource_id": file_upload_4_id,
		"action": "read",
		"organization_group_ids": [org_group_2_id],
	} with data.resource_attributes as resource_attributes
		with data.share_grants as share_grants
}

# A user without a share grant cannot read the assistant.
test_user_without_grant_cannot_read_assistant if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_3_id,
		"resource_kind": "assistant",
		"resource_id": assistant_1_id,
		"action": "read",
	} with data.resource_attributes as resource_attributes
		with data.share_grants as share_grants
}

# --- Assistant Creation Tests ---

# A logged-in user can create an assistant.
test_logged_in_user_can_create_assistant if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "assistant_singleton",
		"resource_id": "__singleton__",
		"action": "create",
	}
}

# A not-logged-in user cannot create an assistant.
test_anonymous_user_cannot_create_assistant if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": "__not_logged_in__",
		"resource_kind": "assistant_singleton",
		"resource_id": "__singleton__",
		"action": "create",
	}
}

# --- Share Grant Tests ---

# A logged-in user can create a share grant (ownership validated in model layer).
test_logged_in_user_can_create_share_grant if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "share_grant",
		"resource_id": "grant-123",
		"action": "create",
	}
}

# A not-logged-in user cannot create a share grant.
test_anonymous_user_cannot_create_share_grant if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": "__not_logged_in__",
		"resource_kind": "share_grant",
		"resource_id": "grant-123",
		"action": "create",
	}
}

# A logged-in user can read share grants (ownership validated in model layer).
test_logged_in_user_can_read_share_grant if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "share_grant",
		"resource_id": "grant-123",
		"action": "read",
	}
}

# A logged-in user can delete share grants (ownership validated in model layer).
test_logged_in_user_can_delete_share_grant if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "share_grant",
		"resource_id": "grant-123",
		"action": "delete",
	}
}

# --- Organization Group Sharing Tests ---

# A user in an organization_group can read an assistant shared with that group.
test_user_in_org_group_can_read_shared_assistant if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_3_id,
		"resource_kind": "assistant",
		"resource_id": assistant_2_id,
		"action": "read",
		"organization_group_ids": [org_group_1_id, org_group_2_id],
	} with data.resource_attributes as resource_attributes
		with data.share_grants as share_grants_with_org_group
}

# A user NOT in the organization_group cannot read the assistant shared with that group.
test_user_not_in_org_group_cannot_read_shared_assistant if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_3_id,
		"resource_kind": "assistant",
		"resource_id": assistant_2_id,
		"action": "read",
		"organization_group_ids": [org_group_2_id],
	} with data.resource_attributes as resource_attributes
		with data.share_grants as share_grants_with_org_group
}

# A user with no organization_group_ids cannot read the assistant shared with a group.
test_user_with_no_org_groups_cannot_read_shared_assistant if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_3_id,
		"resource_kind": "assistant",
		"resource_id": assistant_2_id,
		"action": "read",
		"organization_group_ids": [],
	} with data.resource_attributes as resource_attributes
		with data.share_grants as share_grants_with_org_group
}

# A user in an organization_group cannot update an assistant shared with that group (read-only).
test_user_in_org_group_cannot_update_shared_assistant if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_3_id,
		"resource_kind": "assistant",
		"resource_id": assistant_2_id,
		"action": "update",
		"organization_group_ids": [org_group_1_id],
	} with data.resource_attributes as resource_attributes
		with data.share_grants as share_grants_with_org_group
}

# --- Config Resource Permission Tests ---

test_chat_provider_read_allowed_without_rules if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "chat_provider",
		"resource_id": chat_provider_1_id,
		"action": "read",
		"groups": [],
	} with data.resource_attributes as resource_attributes
		with data.config_permissions as empty_config_permissions
}

test_mcp_server_read_allowed_without_rules if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "mcp_server",
		"resource_id": mcp_server_1_id,
		"action": "read",
		"groups": [],
	} with data.resource_attributes as resource_attributes
		with data.config_permissions as empty_config_permissions
}

test_facet_read_allowed_without_rules if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "facet",
		"resource_id": facet_1_id,
		"action": "read",
		"groups": [],
	} with data.resource_attributes as resource_attributes
		with data.config_permissions as empty_config_permissions
}

test_chat_provider_read_allowed_for_matching_group_rule if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "chat_provider",
		"resource_id": chat_provider_2_id,
		"action": "read",
		"groups": ["premium"],
	} with data.resource_attributes as resource_attributes
		with data.config_permissions as group_config_permissions
}

test_chat_provider_read_denied_without_matching_group_rule if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "chat_provider",
		"resource_id": chat_provider_2_id,
		"action": "read",
		"groups": [],
	} with data.resource_attributes as resource_attributes
		with data.config_permissions as group_config_permissions
}

test_mcp_server_read_allowed_for_matching_group_rule if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "mcp_server",
		"resource_id": mcp_server_2_id,
		"action": "read",
		"groups": ["premium"],
	} with data.resource_attributes as resource_attributes
		with data.config_permissions as group_config_permissions
}

test_mcp_server_read_denied_without_matching_group_rule if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "mcp_server",
		"resource_id": mcp_server_2_id,
		"action": "read",
		"groups": [],
	} with data.resource_attributes as resource_attributes
		with data.config_permissions as group_config_permissions
}

test_facet_read_allowed_for_matching_group_rule if {
	backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "facet",
		"resource_id": facet_2_id,
		"action": "read",
		"groups": ["premium"],
	} with data.resource_attributes as resource_attributes
		with data.config_permissions as group_config_permissions
}

test_facet_read_denied_without_matching_group_rule if {
	not backend.allow with input as {
		"subject_kind": "user",
		"subject_id": user_1_id,
		"resource_kind": "facet",
		"resource_id": facet_2_id,
		"action": "read",
		"groups": [],
	} with data.resource_attributes as resource_attributes
		with data.config_permissions as group_config_permissions
}
