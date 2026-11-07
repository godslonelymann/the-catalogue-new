"""Request and response models. JSON uses camelCase, like the frontend types."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field
from pydantic.alias_generators import to_camel


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class AccountOut(Model):
    id: str
    email: str
    name: str | None
    email_verified: bool
    has_password: bool
    google_linked: bool
    two_factor_enabled: bool
    recovery_codes_left: int


class SignInIn(Model):
    email: EmailStr
    password: str = Field(max_length=256)


class SignInOut(Model):
    status: Literal["signed_in", "two_factor_required"]
    account: AccountOut | None = None


class CodeIn(Model):
    code: str = Field(min_length=6, max_length=32)


class EmailIn(Model):
    email: EmailStr


class CompleteSignupIn(Model):
    token: str = Field(min_length=10, max_length=256)
    name: str = Field(default="", max_length=120)
    password: str = Field(max_length=256)


class ResetPasswordIn(Model):
    token: str = Field(min_length=10, max_length=256)
    password: str = Field(max_length=256)


class ChangePasswordIn(Model):
    current: str = Field(default="", max_length=256)
    next: str = Field(max_length=256)


class SessionOut(Model):
    id: str
    device: str
    created_at: datetime
    last_seen_at: datetime
    current: bool


class TwoFactorSetupOut(Model):
    secret: str
    otpauth_url: str


class RecoveryCodesOut(Model):
    recovery_codes: list[str]
