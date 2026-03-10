from __future__ import annotations

from unittest.mock import Mock, patch
import unittest

from app.config import settings
from app.services.email_sender import send_otp_email, send_password_reset_email


class EmailSenderSesTests(unittest.TestCase):
    def _set_settings(self, **kwargs):
        original: dict[str, object] = {}
        for key, value in kwargs.items():
            original[key] = getattr(settings, key)
            setattr(settings, key, value)
        settings.__dict__.pop("effective_email_sender", None)
        settings.__dict__.pop("effective_aws_ses_region", None)
        settings.__dict__.pop("effective_password_reset_url_template", None)
        return original

    def _restore_settings(self, original: dict[str, object]) -> None:
        for key, value in original.items():
            setattr(settings, key, value)
        settings.__dict__.pop("effective_email_sender", None)
        settings.__dict__.pop("effective_aws_ses_region", None)
        settings.__dict__.pop("effective_password_reset_url_template", None)

    def test_send_otp_email_uses_sesv2_payload(self) -> None:
        old = self._set_settings(
            email_provider="aws_ses",
            environment="production",
            aws_region="us-east-1",
            aws_ses_region=None,
            aws_access_key_id="AKIA_TEST",
            aws_secret_access_key="SECRET_TEST",
            aws_session_token=None,
            aws_ses_configuration_set="otp-config",
            email_otp_sender="noreply@reconlab.ae",
            ses_from_name="ReconLab",
        )
        try:
            with patch("boto3.client") as mocked_client:
                ses_client = Mock()
                mocked_client.return_value = ses_client

                send_otp_email(recipient="user@example.com", code="123456", expires_minutes=10)

                mocked_client.assert_called_once_with(
                    "sesv2",
                    region_name="us-east-1",
                    aws_access_key_id="AKIA_TEST",
                    aws_secret_access_key="SECRET_TEST",
                    aws_session_token=None,
                )
                ses_client.send_email.assert_called_once()
                kwargs = ses_client.send_email.call_args.kwargs
                self.assertEqual(kwargs["FromEmailAddress"], "ReconLab <noreply@reconlab.ae>")
                self.assertEqual(kwargs["Destination"]["ToAddresses"], ["user@example.com"])
                self.assertEqual(kwargs["ConfigurationSetName"], "otp-config")
                self.assertIn("Simple", kwargs["Content"])
        finally:
            self._restore_settings(old)

    def test_send_otp_email_requires_region_for_ses(self) -> None:
        old = self._set_settings(
            email_provider="aws_ses",
            environment="production",
            aws_region="",
            aws_ses_region="",
            email_otp_sender="noreply@reconlab.ae",
            ses_from_name="ReconLab",
        )
        try:
            with self.assertRaises(RuntimeError):
                send_otp_email(recipient="user@example.com", code="123456", expires_minutes=10)
        finally:
            self._restore_settings(old)

    def test_console_provider_blocked_in_production(self) -> None:
        old = self._set_settings(
            email_provider="console",
            environment="production",
            email_otp_sender="noreply@reconlab.ae",
        )
        try:
            with self.assertRaises(RuntimeError):
                send_otp_email(recipient="user@example.com", code="123456", expires_minutes=10)
        finally:
            self._restore_settings(old)

    def test_send_password_reset_email_uses_same_provider_path(self) -> None:
        old = self._set_settings(
            email_provider="aws_ses",
            environment="production",
            aws_region="us-east-1",
            aws_ses_region=None,
            aws_access_key_id="AKIA_TEST",
            aws_secret_access_key="SECRET_TEST",
            aws_session_token=None,
            email_otp_sender="noreply@reconlab.ae",
            ses_from_name="ReconLab",
        )
        try:
            with patch("boto3.client") as mocked_client:
                ses_client = Mock()
                ses_client.send_email.return_value = {"MessageId": "msg-123"}
                mocked_client.return_value = ses_client

                res = send_password_reset_email(
                    recipient="user@example.com",
                    reset_link="https://example.com/reset?token=abc",
                    expires_minutes=30,
                )
                self.assertEqual(res.provider, "aws_ses")
                self.assertEqual(res.message_id, "msg-123")
                ses_client.send_email.assert_called_once()
        finally:
            self._restore_settings(old)

    def test_send_otp_email_over_smtp(self) -> None:
        old = self._set_settings(
            email_provider="smtp",
            environment="production",
            email_otp_sender="noreply@reconlab.ae",
            smtp_host="email-smtp.us-east-1.amazonaws.com",
            smtp_port=587,
            smtp_username="smtp-user",
            smtp_password="smtp-pass",
            smtp_use_tls=True,
            smtp_use_ssl=False,
        )
        try:
            with patch("smtplib.SMTP") as mocked_smtp:
                smtp_client = Mock()
                smtp_client.send_message.return_value = {}
                mocked_smtp.return_value.__enter__.return_value = smtp_client

                res = send_otp_email(recipient="user@example.com", code="123456", expires_minutes=10)
                self.assertEqual(res.provider, "smtp")
                smtp_client.starttls.assert_called_once()
                smtp_client.login.assert_called_once_with("smtp-user", "smtp-pass")
                smtp_client.send_message.assert_called_once()
        finally:
            self._restore_settings(old)


if __name__ == "__main__":
    unittest.main()
