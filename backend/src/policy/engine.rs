use eyre::{eyre, Report, WrapErr};
use regorus::Engine;

use crate::policy::types::{
    Action, Resource, ResourceId, ResourceKind, Subject, SubjectId, SubjectKind,
};

const BACKEND_POLICY: &str = include_str!("../../policy/backend/backend.rego");

// Define a macro that routes to the appropriate authorize implementation based on argument count
macro_rules! authorize {
    // Pattern for the short form (3 arguments)
    ($engine:expr, $subject:expr, $resource:expr, $action:expr) => {
        <crate::policy::engine::PolicyEngine as crate::policy::engine::AuthorizeShort>::authorize(
            &$engine, $subject, $resource, $action,
        )
    };

    // Pattern for the full form (5 arguments)
    ($engine:expr, $subject_kind:expr, $subject_id:expr, $resource_kind:expr, $resource_id:expr, $action:expr) => {
        <crate::policy::engine::PolicyEngine as crate::policy::engine::AuthorizeFull>::authorize(
            &$engine,
            $subject_kind,
            $subject_id,
            $resource_kind,
            $resource_id,
            $action,
        )
    };
}
pub(crate) use authorize;

#[derive(Debug, Clone)]
pub struct PolicyEngine {
    #[allow(unused)]
    engine: Engine,
}

impl PolicyEngine {
    #[allow(unused)]
    pub fn new() -> Result<Self, Report> {
        let mut engine = Engine::new();
        engine.set_rego_v1(true);
        engine
            .add_policy("backend".to_string(), BACKEND_POLICY.to_string())
            .map_err(|err| eyre!(Box::new(err)))
            .wrap_err("Failed to read backend policy")?;
        Ok(Self { engine })
    }
}

impl AuthorizeFull for PolicyEngine {
    fn authorize(
        &self,
        _subject_kind: SubjectKind,
        _subject_id: &SubjectId,
        resource_kind: ResourceKind,
        _resource_id: &ResourceId,
        action: Action,
    ) -> Result<(), Report> {
        // First validate the resource_kind-action combination as an assertion
        authorize_general(resource_kind, action);

        // Add your authorization logic here
        // For now, we'll just allow everything that passes the resource-action validation
        Ok(())
    }
}

// impl Authorize for PolicyEngine {}

pub trait AuthorizeFull {
    fn authorize(
        &self,
        subject_kind: SubjectKind,
        subject_id: &SubjectId,
        resource_kind: ResourceKind,
        resource_id: &ResourceId,
        action: Action,
    ) -> Result<(), Report>;
}

pub trait AuthorizeShort {
    fn authorize<S: Into<Subject>, R: Into<Resource>>(
        &self,
        subject: S,
        resource: R,
        action: Action,
    ) -> Result<(), Report>;
}

// pub trait Authorize: AuthorizeFull + AuthorizeShort {}

impl AuthorizeShort for PolicyEngine {
    fn authorize<S: Into<Subject>, R: Into<Resource>>(
        &self,
        subject: S,
        resource: R,
        action: Action,
    ) -> Result<(), Report> {
        let subject: Subject = subject.into();
        let resource: Resource = resource.into();
        let (subject_kind, subject_id) = subject.clone().into_parts();
        let (resource_kind, resource_id) = resource.clone().into_parts();
        AuthorizeFull::authorize(
            self,
            subject_kind,
            &subject_id,
            resource_kind,
            &resource_id,
            action,
        )
    }
}

// Compile-time validation of resource-action combinations
pub const fn is_valid_resource_action(resource: ResourceKind, action: Action) -> bool {
    #[allow(clippy::match_like_matches_macro)]
    match (resource, action) {
        (ResourceKind::Chat, Action::Read) => true,
        (ResourceKind::Chat, Action::SubmitMessage) => true,
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

        let engine = PolicyEngine::new().unwrap();
        // This should work as Chat + Read is a valid combination
        let result = authorize!(
            engine,
            subject_kind,
            &subject_id,
            resource_kind,
            &resource_id,
            action
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
        let engine = PolicyEngine::new().unwrap();
        authorize!(
            engine,
            subject_kind,
            &subject_id,
            resource_kind,
            &resource_id,
            action
        )
        .unwrap();
    }

    #[test]
    fn test_authorize_short_form() {
        let subject = Subject::User("user1".to_string());
        let resource = Resource::Chat("chat1".to_string());
        let action = Action::Read;

        let engine = PolicyEngine::new().unwrap();
        // This should work using the short form
        let result = authorize!(engine, &subject, &resource, action);
        assert!(result.is_ok());
    }
}
