use eyre::{eyre, Report, WrapErr};
use regorus::Engine;

use crate::policy::types::{Action, ResourceId, ResourceKind, SubjectId, SubjectKind};

const BACKEND_POLICY: &'static str = include_str!("../../policy/backend/backend.rego");

#[derive(Debug)]
pub struct PolicyEngine {
    engine: Engine,
}

impl PolicyEngine {
    pub fn new() -> Result<Self, Report> {
        let mut engine = Engine::new();
        engine.set_rego_v1(true);
        engine
            .add_policy("backend".to_string(), BACKEND_POLICY.to_string())
            .map_err(|err| eyre!(Box::new(err)))
            .wrap_err("Failed to read backend policy")?;
        Ok(Self { engine })
    }

    pub fn authorize(
        &self,
        subject_kind: SubjectKind,
        subject_id: &SubjectId,
        resource_kind: ResourceKind,
        resource_id: &ResourceId,
        action: Action,
    ) -> Result<(), Report> {
        // First validate the resource_kind-action combination as an assertion
        authorize_general(resource_kind, action);

        // Add your authorization logic here
        // For now, we'll just allow everything that passes the resource-action validation
        Ok(())
    }
}

// Compile-time validation of resource-action combinations
pub const fn is_valid_resource_action(resource: ResourceKind, action: Action) -> bool {
    match (resource, action) {
        (ResourceKind::Chat, Action::Read) => true,
        (ResourceKind::ChatSingleton, Action::Create) => true,
        _ => false,
    }
}

pub const fn authorize_general(resource_kind: ResourceKind, action: Action) {
    assert!(
        is_valid_resource_action(resource_kind, action),
        "This resource kind can not be used with this action"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_authorize_macro_success() {
        let subject_kind = SubjectKind::User;
        let subject_id = SubjectId("user1".to_string());
        let resource_kind = ResourceKind::Chat;
        let resource_id = ResourceId("chat1".to_string());
        let action = Action::Read;

        // This should work as Chat + Read is a valid combination
        let result = authorize(
            subject_kind,
            &subject_id,
            resource_kind,
            &resource_id,
            action,
        );
        assert!(result.is_ok());
    }

    #[test]
    #[should_panic(expected = "This resource kind can not be used with this action")]
    fn test_authorize_macro_invalid_combination() {
        let subject_kind = SubjectKind::User;
        let subject_id = SubjectId("user1".to_string());
        let resource_kind = ResourceKind::Chat;
        let resource_id = ResourceId("chat1".to_string());
        let action = Action::Create;

        // This should panic as Chat + Create is not a valid combination
        authorize(
            subject_kind,
            &subject_id,
            resource_kind,
            &resource_id,
            action,
        );
    }
}
