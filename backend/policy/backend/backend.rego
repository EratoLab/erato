package backend

# In the general policy design we check for allow of the following 5-tuple:
#
# - `subject_kind` - The kind of the subject; Subject is the entity trying to execute the `action`. (e.g. `user`)
# - `subject_id` - Unique ID of subject within the specified `subject_kind`. (e.g. the user ID when the `subject_kind` is `user`)
# - `resource_kind` - The kind of the resource we want to execute the `action` with. (e.g. `chat`)
# - `resource_id` - Unique ID of resource within the specified `resource_kind`. (e.g. the chat ID when the `resource_kind` is `chat`)
# - `action` - The action we want to execute (e.g. `read` if we want to read the chat resource)
#
# In some instances we may also want to check for allowing an action in a global context, without referring to a specific instance of a resource.
# In those cases a singleton `resource_kind` should be used, and the `resource_id` value omitted/ignored.
# E.g. when checking whether a user is allowed to create a new chat, we may want to check the `create` action against a `chat_singleton` resource_kind (with is distinct from the `chat` resoure_kind).

# `data` structure
#
# resource_attributes := {
#   "chat": {
#     "some-chat-id": {
#       "id": "some-chat-id",
#       "owner_id": "some-user-id"
#     }
#   }
# }

# `input` structure
# {
#   "subject_kind": "user",
#   "subject_id": "some-user-id",
#   "resource_kind": "chat",
#   "resource_id": "some-chat-id",
#   "action": "read"
# }

# Constants
subject_kind_user = "user"

not_logged_in := "__not_logged_in__"

# Resource kinds
resource_kind_chat := "chat"
resource_kind_chat_singleton := "chat_singleton"
resource_kind_assistant := "assistant"
resource_kind_assistant_singleton := "assistant_singleton"
resource_kind_share_grant := "share_grant"
# Placeholder; to be removed in the future once we have some implementation variance
resource_kind_other := "other"

# Actions
# If allowed, allows the resource to be read.
action_read := "read"
# If allowed on singleton resources, allows the resource to be created.
action_create := "create"
# If allowed on a chat, allows a message to be submitted.
action_submit_message := "submit_message"
action_update := "update"
action_delete := "delete"
action_share := "share"

# Default deny all access
default allow = false

# A user can view/update chats they own.
allow if {
	# Ensure subject is a user and is logged in.
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in

	# Check for chat read action
	input.resource_kind == resource_kind_chat
	input.action in [action_read, action_update]

	# Check ownership
	data.resource_attributes[resource_kind_chat][input.resource_id].owner_id == input.subject_id
}

# A user can submit messages to chats they own.
allow if {
	# Ensure subject is a user and is logged in.
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in

	# Check for chat submit message action
	input.resource_kind == resource_kind_chat
	input.action == action_submit_message

	# Check ownership
	data.resource_attributes[resource_kind_chat][input.resource_id].owner_id == input.subject_id
}

# A logged-in user can create a chat.
allow if {
	# Ensure subject is a user and is logged in.
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in

	# Check for chat create action on singleton resource
	input.resource_kind == resource_kind_chat_singleton
	input.action == action_create
}

# A user can read/update/share assistants they own.
allow if {
	# Ensure subject is a user and is logged in.
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in

	# Check for assistant read/update/share action
	input.resource_kind == resource_kind_assistant
	input.action in [action_read, action_update, action_share]

	# Check ownership
	data.resource_attributes[resource_kind_assistant][input.resource_id].owner_id == input.subject_id
}

# A viewer (via share_grant) can read an assistant.
allow if {
	# Ensure subject is a user and is logged in.
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in

	# Check for assistant read action
	input.resource_kind == resource_kind_assistant
	input.action == action_read

	# Check if there's a share grant for this user and resource
	some grant in data.share_grants
	grant.resource_type == "assistant"
	grant.resource_id == input.resource_id
	grant.subject_type == "user"
	grant.subject_id == input.subject_id
	grant.role == "viewer"
}

# A logged-in user can create an assistant.
allow if {
	# Ensure subject is a user and is logged in.
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in

	# Check for assistant create action on singleton resource
	input.resource_kind == resource_kind_assistant_singleton
	input.action == action_create
}

# A user can create a share grant if they own the resource.
allow if {
	# Ensure subject is a user and is logged in.
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in

	# Check for share grant create action
	input.resource_kind == resource_kind_share_grant
	input.action == action_create

	# The authorization logic for checking resource ownership is handled in the model layer
	# This just allows the action if the user is logged in
}

# A user can read share grants for resources they own.
allow if {
	# Ensure subject is a user and is logged in.
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in

	# Check for share grant read action
	input.resource_kind == resource_kind_share_grant
	input.action == action_read

	# The authorization logic for checking resource ownership is handled in the model layer
}

# A user can delete share grants for resources they own.
allow if {
	# Ensure subject is a user and is logged in.
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in

	# Check for share grant delete action
	input.resource_kind == resource_kind_share_grant
	input.action == action_delete

	# The authorization logic for checking resource ownership is handled in the model layer
}