"""Account emails, sent from a Gmail account over SMTP with an app password."""

import html
import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from typing import Protocol

from .config import get_settings

log = logging.getLogger(__name__)


@dataclass
class Email:
    to: str
    subject: str
    text: str
    html: str
    # A stable key for retries. SMTP has no idempotency feature, so the key becomes a fixed
    # Message-ID: a retried copy carries the same ID. The caller must not resend after success.
    idempotency_key: str | None = None


class EmailSendError(Exception):
    """The SMTP server didn't accept the email."""


class EmailSender(Protocol):
    def send(self, email: Email) -> None: ...


def build_message(email: Email) -> EmailMessage:
    settings = get_settings()
    message = EmailMessage()
    message["From"] = settings.email_from
    message["To"] = email.to
    message["Subject"] = email.subject
    message["Date"] = formatdate(localtime=False, usegmt=True)
    sender_domain = settings.email_from.rsplit("@", 1)[-1].rstrip(">").strip() or None
    message["Message-ID"] = (
        f"<{email.idempotency_key}@{sender_domain}>" if email.idempotency_key else make_msgid(domain=sender_domain)
    )
    if settings.email_reply_to:
        message["Reply-To"] = settings.email_reply_to
    message.set_content(email.text)
    message.add_alternative(email.html, subtype="html")
    return message


class SmtpSender:
    """Sends through smtp.gmail.com:587 with STARTTLS. Gmail needs an app password, not the account password."""

    def send(self, email: Email) -> None:
        settings = get_settings()
        if not settings.smtp_username or not settings.smtp_password or not settings.email_from:
            raise EmailSendError("SMTP_USERNAME, SMTP_PASSWORD, or EMAIL_FROM is empty.")
        message = build_message(email)
        context = ssl.create_default_context()
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=settings.smtp_timeout_seconds) as smtp:
                smtp.starttls(context=context)
                smtp.login(settings.smtp_username, settings.smtp_password)
                refused = smtp.send_message(message)
        except (smtplib.SMTPException, OSError) as error:
            # Don't log the address or the link. The error type and SMTP code are enough.
            code = getattr(error, "smtp_code", None)
            raise EmailSendError(f"{type(error).__name__}{f' ({code})' if code else ''}") from error
        if refused:
            raise EmailSendError("The SMTP server refused the recipient.")


def deliver_in_background(sender: EmailSender, email: Email) -> None:
    """For account emails sent after the response. Failures are logged, not raised."""
    try:
        sender.send(email)
    except EmailSendError as error:
        log.error("Email not sent (%s): %s", email.subject, error)


_sender: EmailSender = SmtpSender()


def get_email_sender() -> EmailSender:
    return _sender


IGNORE_FOOTER = "If you didn’t ask for this, you can ignore this email."


def _layout(heading: str, body: str, link: str | None = None, button: str | None = None, footer: str = IGNORE_FOOTER) -> str:
    action = (
        f'<p style="margin:24px 0"><a href="{html.escape(link)}" '
        f'style="background:#0a0a0a;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600">'
        f"{html.escape(button or 'Open')}</a></p>"
        f'<p style="color:#5c5c5c;font-size:13px">Or paste this link into your browser:<br>{html.escape(link)}</p>'
        if link
        else ""
    )
    return (
        '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0a0a0a;max-width:480px">'
        f'<h1 style="font-size:22px">{html.escape(heading)}</h1><p style="line-height:1.5">{body}</p>{action}'
        f'<p style="color:#5c5c5c;font-size:13px">{html.escape(footer)}</p></div>'
    )


def verify_email(to: str, link: str, minutes: int) -> Email:
    text = (
        "Confirm your email to finish creating your account on The Catalogue.\n\n"
        f"{link}\n\nThe link expires in {minutes} minutes."
    )
    body = f"Confirm your email to finish creating your account. The link expires in {minutes} minutes."
    return Email(to, "Confirm your email for The Catalogue", text, _layout("Confirm your email", body, link, "Confirm email"))


def account_exists(to: str, sign_in_link: str, reset_link: str) -> Email:
    text = (
        "Someone tried to create a new account on The Catalogue with this email. You already have an account.\n\n"
        f"Sign in: {sign_in_link}\nForgot your password? {reset_link}"
    )
    body = (
        "Someone tried to create a new account with this email. You already have an account. "
        f'Sign in, or <a href="{html.escape(reset_link)}">reset your password</a>.'
    )
    return Email(
        to,
        "You already have an account on The Catalogue",
        text,
        _layout("You already have an account", body, sign_in_link, "Sign in"),
    )


def reset_password(to: str, link: str, minutes: int) -> Email:
    text = (
        "Use this link to choose a new password for The Catalogue.\n\n"
        f"{link}\n\nThe link expires in {minutes} minutes. All your devices will be signed out."
    )
    body = f"Use this link to choose a new password. It expires in {minutes} minutes. All your devices will be signed out."
    return Email(
        to, "Reset your password for The Catalogue", text, _layout("Reset your password", body, link, "Choose a new password")
    )


def back_in_stock(to: str, alert_id: str, product: str, option: str, store: str, store_link: str, app_link: str) -> Email:
    text = (
        f"{product} ({option}) from {store} is back in stock.\n\n"
        f"Buy it on the store: {store_link}\nSee it on The Catalogue: {app_link}\n\n"
        "This alert is now done. Set a new alert if this option sells out again."
    )
    body = (
        f"<strong>{html.escape(product)}</strong> ({html.escape(option)}) from {html.escape(store)} is back in stock. "
        f'See it on <a href="{html.escape(app_link)}">The Catalogue</a>.'
    )
    footer = "This alert is now done. Set a new alert if this option sells out again."
    return Email(
        to,
        f"Back in stock: {product} ({option})",
        text,
        _layout("Back in stock", body, store_link, "Go to the store", footer),
        # A fixed Message-ID per alert, so a retried copy is the same message.
        idempotency_key=f"restock-{alert_id}",
    )
