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
#   },
#   "assistant": {
#     "some-assistant-id": {
#       "id": "some-assistant-id",
#       "owner_id": "some-user-id"
#     }
#   },
#   "file_upload": {
#     "some-file-upload-id": {
#       "id": "some-file-upload-id",
#       "owner_id": "some-user-id",
#       "linked_chat_ids": ["some-chat-id"],
#       "linked_assistant_ids": ["some-assistant-id"]
#     }
#   }
# }
#
# share_grants := [
#   {
#     "id": "some-grant-id",
#     "resource_type": "assistant",
#     "resource_id": "some-assistant-id",
#     "subject_type": "user", # or "organization_group"
#     "subject_id_type": "id", # or "organization_group_id"
#     "subject_id": "some-user-id",
#     "role": "viewer"
#   }
# ]
#
# share_links := [
#   {
#     "id": "some-link-id",
#     "resource_type": "chat",
#     "resource_id": "some-chat-id",
#     "enabled": true
#   }
# ]

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
resource_kind_prompt_optimizer_singleton := "prompt_optimizer_singleton"
resource_kind_message_feedback := "message_feedback"
resource_kind_assistant := "assistant"
resource_kind_file_upload := "file_upload"
resource_kind_assistant_singleton := "assistant_singleton"
resource_kind_share_grant := "share_grant"
resource_kind_chat_provider := "chat_provider"
resource_kind_mcp_server := "mcp_server"
resource_kind_facet := "facet"
# Placeholder; to be removed in the future once we have some implementation variance
resource_kind_other := "other"

# Actions
# If allowed, allows the resource to be read.
action_read := "read"
# If allowed on singleton resources, allows the resource to be created.
action_create := "create"
# If allowed on a chat, allows a message to be submitted.
action_submit_message := "submit_message"
# If allowed on a message, allows feedback to be submitted.
action_submit_feedback := "submit_feedback"
action_update := "update"
action_delete := "delete"
action_share := "share"

chat_sharing_enabled if {
	data.config.chat_sharing.enabled
}

has_enabled_share_link(resource_type, resource_id) if {
	some link in data.share_links
	link.resource_type == resource_type
	link.resource_id == resource_id
	link.enabled
}

# Default deny all access
default allow = false

config_permission_rule_applies(rule, resource_id) if {
	rule.rule_type == "allow-all"
	resource_id in rule.resource_ids
}

config_permission_rule_applies(rule, resource_id) if {
	rule.rule_type == "allow-for-group-members"
	resource_id in rule.resource_ids
	some group_id in input.groups
	group_id in rule.groups
}

allow_config_resource(resource_kind) if {
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in
	input.resource_kind == resource_kind
	input.action == action_read
	data.resource_attributes[resource_kind][input.resource_id].id == input.resource_id
	count(object.get(data.config_permissions, resource_kind, [])) == 0
}

allow_config_resource(resource_kind) if {
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in
	input.resource_kind == resource_kind
	input.action == action_read
	data.resource_attributes[resource_kind][input.resource_id].id == input.resource_id
	some rule in data.config_permissions[resource_kind]
	config_permission_rule_applies(rule, input.resource_id)
}

can_read_assistant(assistant_id) if {
	data.resource_attributes[resource_kind_assistant][assistant_id].owner_id == input.subject_id
}

can_read_assistant(assistant_id) if {
	some grant in data.share_grants
	grant.resource_type == "assistant"
	grant.resource_id == assistant_id
	grant.subject_type == "user"
	grant.subject_id == input.subject_id
	grant.role == "viewer"
}

can_read_shared_chat(chat_id) if {
	chat_sharing_enabled
	has_enabled_share_link(resource_kind_chat, chat_id)
	data.resource_attributes[resource_kind_chat][chat_id].archived_at == null
}

can_read_assistant(assistant_id) if {
	some grant in data.share_grants
	grant.resource_type == "assistant"
	grant.resource_id == assistant_id
	grant.subject_type == "organization_group"
	grant.role == "viewer"

	some group_id in input.organization_group_ids
	group_id == grant.subject_id
}

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

# A user can share chats they own.
allow if {
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in
	input.resource_kind == resource_kind_chat
	input.action == action_share
	data.resource_attributes[resource_kind_chat][input.resource_id].owner_id == input.subject_id
}

# A logged-in user can read a chat when chat sharing is enabled and the chat has an active share link.
allow if {
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in
	input.resource_kind == resource_kind_chat
	input.action == action_read
	can_read_shared_chat(input.resource_id)
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

# A logged-in user can use the prompt optimizer.
allow if {
	# Ensure subject is a user and is logged in.
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in

	# Check for prompt optimizer create action on singleton resource
	input.resource_kind == resource_kind_prompt_optimizer_singleton
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

# A user can read file uploads they own.
allow if {
	# Ensure subject is a user and is logged in.
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in

	# Check for file upload read action
	input.resource_kind == resource_kind_file_upload
	input.action == action_read

	# Check ownership
	data.resource_attributes[resource_kind_file_upload][input.resource_id].owner_id == input.subject_id
}

# A user can update their own file uploads.
allow if {
	# Ensure subject is a user and is logged in.
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in

	# Check for file upload update action
	input.resource_kind == resource_kind_file_upload
	input.action == action_update

	# Check ownership
	data.resource_attributes[resource_kind_file_upload][input.resource_id].owner_id == input.subject_id
}

# A user can read file uploads if they can access one of the linked chats.
allow if {
	# Ensure subject is a user and is logged in.
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in

	# Check for file upload read action
	input.resource_kind == resource_kind_file_upload
	input.action == action_read

	# Any linked chat owned by the subject grants access.
	some chat_id in data.resource_attributes[resource_kind_file_upload][input.resource_id].linked_chat_ids
	data.resource_attributes[resource_kind_chat][chat_id].owner_id == input.subject_id
}

# A user can read file uploads if they can access one of the linked shared chats.
allow if {
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in
	input.resource_kind == resource_kind_file_upload
	input.action == action_read

	some chat_id in data.resource_attributes[resource_kind_file_upload][input.resource_id].linked_chat_ids
	can_read_shared_chat(chat_id)
}

# A user can read file uploads if they can access one of the linked assistants.
allow if {
	# Ensure subject is a user and is logged in.
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in

	# Check for file upload read action
	input.resource_kind == resource_kind_file_upload
	input.action == action_read

	# Any linked assistant that is readable by the subject grants access.
	some assistant_id in data.resource_attributes[resource_kind_file_upload][input.resource_id].linked_assistant_ids
	can_read_assistant(assistant_id)
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

# A user who belongs to an organization_group (via share_grant) can read an assistant.
allow if {
	# Ensure subject is a user and is logged in.
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in

	# Check for assistant read action
	input.resource_kind == resource_kind_assistant
	input.action == action_read

	# Check if there's a share grant for an organization group
	some grant in data.share_grants
	grant.resource_type == "assistant"
	grant.resource_id == input.resource_id
	grant.subject_type == "organization_group"
	grant.role == "viewer"

	# Check if the user belongs to this organization group
	some group_id in input.organization_group_ids
	group_id == grant.subject_id
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

allow if {
	allow_config_resource(resource_kind_chat_provider)
}

allow if {
	allow_config_resource(resource_kind_mcp_server)
}

allow if {
	allow_config_resource(resource_kind_facet)
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

# A user can submit/update feedback for a message (ownership check in model layer).
allow if {
	# Ensure subject is a user and is logged in.
	input.subject_kind == subject_kind_user
	input.subject_id != not_logged_in

	# Check for message feedback submit action
	input.resource_kind == resource_kind_message_feedback
	input.action == action_submit_feedback

	# The authorization logic for checking message/chat ownership is handled in the model layer
}
