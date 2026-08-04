"""
Pusher Beams Service — Send push notifications to browsers
═══════════════════════════════════════════════════════════════

This service handles sending push notifications via Pusher Beams.

HOW IT WORKS:
  1. Client gets the instance ID from your server (beams-config endpoint)
  2. Client initializes Pusher Beams SDK and registers device
  3. Client calls setUserId() with a token provider for authenticated users
  4. When a message is sent, backend publishes to the receiver's user ID
  5. Pusher Beams delivers the notification to all user's devices
  6. Service Worker (sw.js) receives and shows the notification

AUTHENTICATED USERS (token-based):
  - Client calls setUserId(userId, tokenProvider)
  - Token provider fetches token from backend (server generates JWT)
  - Backend signs token with secret key using HS256
  - Security: only authenticated users can subscribe to their own ID

FREE TIER:
  - 500,000 notifications/month
  - No credit card required
  - Unlimited devices per user
"""

import time
import logging
import jwt
from pusher_push_notifications import PushNotifications

logger = logging.getLogger(__name__)

# Global Pusher Beams client (initialized in init_pusher)
_pusher_client = None
_instance_id = ""
_secret_key = ""


def init_pusher(instance_id: str, secret_key: str):
    """
    Initialize the Pusher Beams client.

    Called once during app startup (in app/__init__.py).

    Args:
        instance_id: Pusher Beams instance ID from dashboard
        secret_key: Pusher Beams secret key from dashboard
    """
    global _pusher_client, _instance_id, _secret_key

    if not instance_id or not secret_key or instance_id == "YOUR_INSTANCE_ID_HERE":
        logger.warning("Pusher Beams not configured — push notifications disabled")
        return

    try:
        _pusher_client = PushNotifications(instance_id, secret_key)
        _instance_id = instance_id
        _secret_key = secret_key
        logger.info("Pusher Beams initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize Pusher Beams: {e}")
        _pusher_client = None


def get_instance_id() -> str:
    """Return the Pusher Beams instance ID (for client-side SDK initialization)."""
    return _instance_id


def generate_beams_token(user_id: int) -> str:
    """
    Generate a Pusher Beams authentication token for a user.

    Uses the official Pusher Beams SDK method to create the token, which
    signs it correctly using Beams' internal key derivation. Do NOT hand-roll
    this with jwt.encode() — Beams tokens are not a plain HS256 JWT signed
    with the raw secret key, so a manually-built token will fail server-side
    verification even though it looks like a valid JWT.

    Args:
        user_id: The user's ID to generate token for

    Returns:
        JWT token string, or empty string if not configured
    """
    if not _pusher_client:
        logger.debug("Pusher Beams not configured — cannot generate token")
        return ""

    external_user_id = f"user_{user_id}"

    try:
        # generate_token() is provided by the pusher_push_notifications SDK
        # and returns {"token": "<signed jwt>"}
        beams_token = _pusher_client.generate_token(external_user_id)
        logger.debug(f"Generated Beams token for user {user_id}")
        return beams_token["token"]
    except Exception as e:
        logger.error(f"Failed to generate Beams token for user {user_id}: {e}")
        return ""


def send_notification(user_id: str, title: str, body: str, data: dict = None):
    """
    Send a push notification to all devices of an authenticated user.

    Args:
        user_id: The external user ID (e.g., "user_42")
        title: Notification title
        body: Notification body
        data: Optional extra data to send with the notification

    Returns:
        True if notification was published, False otherwise
    """
    if not _pusher_client:
        print("Pusher Beams not configured — skipping notification")
        return False

    # Build the publish request
    publish_request = {
        "web": {
            "notification": {
                "title": title,
                "body": body,
                "icon": "https://images.rawpixel.com/image_png_800/cHJpdmF0ZS9sci9pbWFnZXMvd2Vic2l0ZS8yMDI0LTA0L3N0YXJ0dXBpbWFnZXNfM2RfcmVuZGVyX29mX2FfbGV0dGVyX21fZmxhdF9sYXlfdG9wX3ZpZXdfdmVyeV90aF83YWU3YmExOC04NGYyLTRlNjktYWZlMS01MGRkYzM1YTMwZjIucG5n.png",
                "data": data or {},
            }
        },
    }

    try:
        # publish_to_users sends to all devices of authenticated users
        # This works with setUserId() on the client side
        response = _pusher_client.publish_to_users(
            user_ids=[user_id],
            publish_body=publish_request,
        )
        print(f"Notification sent to {user_id}: {response}")
        return True
    except Exception as e:
        print(f"Failed to send notification to {user_id}: {e}")
        return False


def send_message_notification(
    receiver_id: int, sender_username: str, message_content: str
):
    """
    Convenience function to send a new message notification.

    Args:
        receiver_id: The user ID of the message receiver
        sender_username: The username of the message sender
        message_content: The message text (truncated to 100 chars for notification)
    """
    # Truncate long messages for the notification body
    truncated = (
        message_content[:100] + "..." if len(message_content) > 100 else message_content
    )
    if not truncated:
        truncated = "📷 Photo"

    title = f"New message from {sender_username}"
    body = truncated

    data = {
        "type": "new_message",
        "sender_username": sender_username,
    }

    # Send to the receiver's user ID (e.g., "user_42")
    user_id = f"user_{receiver_id}"
    send_notification(user_id, title, body, data)
