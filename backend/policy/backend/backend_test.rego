package backend_test

import data.backend

# Test data
user_1_id := "user-1"
user_2_id := "user-2"
chat_1_id := "chat-1"

resource_attributes := {
	"chat": {
		chat_1_id: {
			"id": chat_1_id,
			"owner_id": user_1_id,
		},
	},
}

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