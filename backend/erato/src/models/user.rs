use crate::db::entity::prelude::*;
use crate::db::entity::users;
use eyre::Report;
use sea_orm::prelude::*;
use sea_orm::{ActiveValue, DatabaseConnection, EntityTrait};

pub async fn get_or_create_user(
    conn: &DatabaseConnection,
    issuer: &str,
    subject: &str,
    email: Option<&str>,
) -> Result<users::Model, Report> {
    let user: Option<users::Model> = Users::find()
        .filter(users::Column::Issuer.eq(issuer))
        .filter(users::Column::Subject.eq(subject))
        .one(conn)
        .await?;

    if let Some(user) = user {
        Ok(user)
    } else {
        let new_user = users::ActiveModel {
            issuer: ActiveValue::Set(issuer.to_owned()),
            subject: ActiveValue::Set(subject.to_owned()),
            email: ActiveValue::Set(email.map(ToOwned::to_owned)),
            ..Default::default()
        };
        let created_user = users::Entity::insert(new_user)
            .exec_with_returning(conn)
            .await?;
        // let created_user = unimplemented!();
        Ok(created_user)
    }
}

/// Remember the user's Entra object ID (`oid`), which is how the Teams bot
/// identifies them. Written only when it changed, so the login path stays
/// read-only for known users.
///
/// A conflicting row (the same `oid` on a different issuer/subject pair) is
/// left alone: the unique index makes the bot's lookup unambiguous, and which
/// row owns the ID is not something a login should silently rewrite.
pub async fn record_entra_object_id(
    conn: &DatabaseConnection,
    user: &users::Model,
    entra_object_id: &str,
) -> Result<(), Report> {
    if user.entra_object_id.as_deref() == Some(entra_object_id) {
        return Ok(());
    }
    let owner = Users::find()
        .filter(users::Column::EntraObjectId.eq(entra_object_id))
        .one(conn)
        .await?;
    if let Some(owner) = owner
        && owner.id != user.id
    {
        tracing::warn!(
            user_id = %user.id,
            owner_user_id = %owner.id,
            "Entra object ID is already recorded on another user; not reassigning it"
        );
        return Ok(());
    }
    let update = users::ActiveModel {
        id: ActiveValue::Unchanged(user.id),
        entra_object_id: ActiveValue::Set(Some(entra_object_id.to_owned())),
        ..Default::default()
    };
    users::Entity::update(update).exec(conn).await?;
    Ok(())
}

/// The user a Teams activity belongs to, by Entra object ID.
pub async fn find_user_by_entra_object_id(
    conn: &DatabaseConnection,
    entra_object_id: &str,
) -> Result<Option<users::Model>, Report> {
    Ok(Users::find()
        .filter(users::Column::EntraObjectId.eq(entra_object_id))
        .one(conn)
        .await?)
}
