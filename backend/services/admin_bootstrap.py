from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from config import Settings
from models.user import User
from security import hash_password, verify_password


def ensure_user_auth_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    column_names = {column["name"] for column in inspector.get_columns("users")}
    statements: list[str] = []
    if "is_admin" not in column_names:
        statements.append(
            "ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE"
        )
    if "google_sub" not in column_names:
        statements.append("ALTER TABLE users ADD COLUMN google_sub VARCHAR(255) NULL")

    if statements:
        with engine.begin() as connection:
            for statement in statements:
                connection.execute(text(statement))

    refreshed_inspector = inspect(engine)
    index_names = {
        index["name"] for index in refreshed_inspector.get_indexes("users") if index.get("name")
    }
    unique_names = {
        constraint["name"]
        for constraint in refreshed_inspector.get_unique_constraints("users")
        if constraint.get("name")
    }
    if "uq_users_google_sub" not in index_names | unique_names:
        with engine.begin() as connection:
            connection.execute(
                text("CREATE UNIQUE INDEX uq_users_google_sub ON users (google_sub)")
            )


def bootstrap_admin_user(db: Session, settings: Settings) -> None:
    admin_email = settings.admin_email
    admin_password = settings.admin_password
    if not admin_email or not admin_password:
        return

    admin_user = db.query(User).filter(User.email == admin_email).first()
    if admin_user is None:
        admin_user = User(
            full_name=settings.admin_full_name,
            email=admin_email,
            hashed_password=hash_password(admin_password),
            is_admin=True,
        )
        db.add(admin_user)
        db.commit()
        return

    updated = False
    if not admin_user.is_admin:
        admin_user.is_admin = True
        updated = True
    if admin_user.full_name != settings.admin_full_name:
        admin_user.full_name = settings.admin_full_name
        updated = True
    if not verify_password(admin_password, admin_user.hashed_password):
        admin_user.hashed_password = hash_password(admin_password)
        updated = True

    if updated:
        db.commit()
