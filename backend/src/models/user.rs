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

    if let None = user {
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
    } else {
        Ok(user.unwrap())
    }
}
