import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from models.user import User
from security import create_access_token, get_current_user, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


class UserCreateRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=255)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class GoogleLoginRequest(BaseModel):
    credential: str = Field(min_length=1)


class UserResponse(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    is_admin: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


def _verify_google_identity_token(credential: str) -> tuple[str, str, str]:
    settings = get_settings()
    if not settings.google_client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google login is not configured on the server.",
        )

    try:
        payload = google_id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            settings.google_client_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google login credential.",
        ) from exc

    google_sub = str(payload.get("sub") or "").strip()
    email = str(payload.get("email") or "").strip().lower()
    full_name = str(payload.get("name") or "").strip() or email.split("@")[0]

    if not google_sub or not email or not payload.get("email_verified"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google account email verification is required.",
        )

    return google_sub, email, full_name


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register_user(
    payload: UserCreateRequest,
    db: Session = Depends(get_db),
) -> AuthResponse:
    normalized_email = payload.email.lower()
    existing_user = db.query(User).filter(User.email == normalized_email).first()
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists.",
        )

    user = User(
        full_name=payload.full_name.strip(),
        email=normalized_email,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return AuthResponse(access_token=create_access_token(user.id), user=user)


@router.post("/login", response_model=AuthResponse)
def login_user(
    payload: UserLoginRequest,
    db: Session = Depends(get_db),
) -> AuthResponse:
    normalized_email = payload.email.lower()
    user = db.query(User).filter(User.email == normalized_email).first()
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    return AuthResponse(access_token=create_access_token(user.id), user=user)


@router.post("/google", response_model=AuthResponse)
def login_with_google(
    payload: GoogleLoginRequest,
    db: Session = Depends(get_db),
) -> AuthResponse:
    google_sub, email, full_name = _verify_google_identity_token(payload.credential)

    user = db.query(User).filter(User.google_sub == google_sub).first()
    if user is None:
        user = db.query(User).filter(User.email == email).first()
        if user is not None and user.google_sub and user.google_sub != google_sub:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This email is already linked to another Google account.",
            )

    if user is None:
        user = User(
            full_name=full_name,
            email=email,
            google_sub=google_sub,
            hashed_password=hash_password(secrets.token_urlsafe(32)),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return AuthResponse(access_token=create_access_token(user.id), user=user)

    updated = False
    if user.google_sub != google_sub:
        user.google_sub = google_sub
        updated = True
    if user.full_name != full_name:
        user.full_name = full_name
        updated = True
    if user.email != email:
        email_owner = (
            db.query(User)
            .filter(
                User.id != user.id,
                or_(User.email == email, User.google_sub == google_sub),
            )
            .first()
        )
        if email_owner is None:
            user.email = email
            updated = True

    if updated:
        db.commit()
        db.refresh(user)

    return AuthResponse(access_token=create_access_token(user.id), user=user)


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)) -> User:
    return current_user
