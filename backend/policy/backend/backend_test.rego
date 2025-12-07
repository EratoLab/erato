package backend_test

import data.backend

# Test data
user_1_id := "user-1"
user_2_id := "user-2"
user_3_id := "user-3"
chat_1_id := "chat-1"
assistant_1_id := "assistant-1"
assistant_2_id := "assistant-2"

resource_attributes := {
	"chat": {
		chat_1_id: {
			"id": chat_1_id,
			"owner_id": user_1_id,
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
		"resource_id": assistant_2_id,
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
		"resource_id": assistant_2_id,
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