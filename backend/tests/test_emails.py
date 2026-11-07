"""The Gmail SMTP sender, with a fake SMTP server. Nothing reaches Gmail."""

import smtplib

import pytest

from app import emails
from app.config import get_settings
from app.emails import Email, EmailSendError, SmtpSender, deliver_in_background


class FakeSMTP:
    instances: list["FakeSMTP"] = []
    fail_login = False

    def __init__(self, host, port, timeout):
        self.host, self.port, self.timeout = host, port, timeout
        self.calls: list[str] = []
        self.messages = []
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.calls.append("quit")

    def starttls(self, context):
        self.calls.append("starttls")

    def login(self, username, password):
        self.calls.append(f"login:{username}")
        if FakeSMTP.fail_login:
            raise smtplib.SMTPAuthenticationError(535, b"Username and Password not accepted")

    def send_message(self, message):
        self.calls.append("send")
        self.messages.append(message)
        return {}


@pytest.fixture
def smtp(monkeypatch):
    FakeSMTP.instances.clear()
    FakeSMTP.fail_login = False
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setenv("SMTP_USERNAME", "sender@gmail.com")
    monkeypatch.setenv("SMTP_PASSWORD", "abcd efgh ijkl mnop")
    monkeypatch.setenv("EMAIL_FROM", "The Catalogue <sender@gmail.com>")
    monkeypatch.setenv("EMAIL_REPLY_TO", "help@example.com")
    get_settings.cache_clear()
    yield FakeSMTP
    get_settings.cache_clear()


def test_sends_to_the_users_address_over_starttls(smtp):
    email = emails.verify_email("riya@example.com", "http://localhost:5173/verify-email?token=abc", 30)
    SmtpSender().send(email)
    server = smtp.instances[0]
    assert (server.host, server.port) == ("smtp.gmail.com", 587)
    assert server.calls == ["starttls", "login:sender@gmail.com", "send", "quit"]
    message = server.messages[0]
    assert message["To"] == "riya@example.com"
    assert message["From"] == "The Catalogue <sender@gmail.com>"
    assert message["Reply-To"] == "help@example.com"
    assert message.get_body(("plain",)).get_content().count("verify-email?token=abc") == 1
    assert message.get_body(("html",)) is not None


def test_retries_reuse_the_same_message_id(smtp):
    email = Email("riya@example.com", "Back in stock", "text", "<p>html</p>", idempotency_key="delivery-42")
    SmtpSender().send(email)
    SmtpSender().send(email)
    ids = [server.messages[0]["Message-ID"] for server in smtp.instances]
    assert ids == ["<delivery-42@gmail.com>"] * 2


def test_login_failure_raises(smtp):
    smtp.fail_login = True
    with pytest.raises(EmailSendError, match="SMTPAuthenticationError"):
        SmtpSender().send(Email("riya@example.com", "s", "t", "<p>h</p>"))


def test_missing_password_raises_without_connecting(smtp, monkeypatch):
    monkeypatch.setenv("SMTP_PASSWORD", "")
    get_settings.cache_clear()
    with pytest.raises(EmailSendError):
        SmtpSender().send(Email("riya@example.com", "s", "t", "<p>h</p>"))
    assert smtp.instances == []


def test_background_delivery_logs_instead_of_raising(smtp, caplog):
    smtp.fail_login = True
    deliver_in_background(SmtpSender(), Email("riya@example.com", "Confirm", "t", "<p>h</p>"))
    assert "Email not sent (Confirm)" in caplog.text
    assert "riya@example.com" not in caplog.text
