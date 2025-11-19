pub mod engine;
pub mod types;

pub mod prelude {
    pub use crate::policy::engine::PolicyEngine;
    pub(crate) use crate::policy::engine::authorize;
    pub use crate::policy::types::{
        Action, Resource, ResourceId, ResourceKind, Subject, SubjectId, SubjectKind,
    };
}
