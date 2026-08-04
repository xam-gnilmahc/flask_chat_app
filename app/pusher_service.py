"""
Pusher Beams Service — Push notifications via Pusher Beams REST API
═══════════════════════════════════════════════════════════════════════

Server-side:
  - Token generation: SDK's generate_token() creates JWT for client auth
  - Sending notifications: REST API directly (avoids SDK recursion bug)

Client-side:
  - setUserId() + TokenProvider authenticates device to a user
  - pusher.js fetches token from /api/chat/beams-token
  - sw.js shows the notification in browser
"""

import logging
import jwt
import requests
from pusher_push_notifications import PushNotifications

logger = logging.getLogger(__name__)

_pusher_client = None
_instance_id = ""
_secret_key = ""


def init_pusher(instance_id: str, secret_key: str):
    """Initialize Pusher Beams client for token generation."""
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
    return _instance_id


def generate_beams_token(user_id: int) -> str:
    """
    Generate Pusher Beams JWT token for client-side setUserId().
    Uses SDK's generate_token() — cannot use raw jwt.encode() here.
    """
    if not _pusher_client:
        return ""

    try:
        beams_token = _pusher_client.generate_token(f"user_{user_id}")
        return beams_token["token"]
    except Exception as e:
        logger.error(f"Failed to generate Beams token for user {user_id}: {e}")
        return ""


def send_notification(user_id: str, title: str, body: str, data: dict = None):
    """Send push notification via Pusher Beams REST API (bypasses SDK bug)."""
    if not _instance_id or not _secret_key:
        print("Pusher Beams not configured — skipping notification")
        return False

    publish_request = {
        "users": [user_id],
        "web": {
            "notification": {
                "title": title,
                "body": body,
                "icon": "https://cdn-icons-png.flaticon.com/512/1827/1827933.png",
                "data": data or {},
            }
        },
    }

    try:
        url = f"https://{_instance_id}.pushnotifications.pusher.com/publish_api/v1/instances/{_instance_id}/publishes/users"
        response = requests.post(
            url,
            json=publish_request,
            headers={
                "Authorization": f"Bearer {_secret_key}",
                "Content-Type": "application/json",
            },
            timeout=10,
        )
        print(f"Notification sent to {user_id}: {response.status_code} {response.text}")
        return response.ok
    except Exception as e:
        print(f"Failed to send notification to {user_id}: {e}")
        return False


def send_message_notification(receiver_id: int, sender_username: str, message_content: str):
    """Send new message notification to a user."""
    truncated = message_content[:100] + "..." if len(message_content) > 100 else message_content
    if not truncated:
        truncated = "Photo"

    title = f"New message from {sender_username}"
    body = truncated
    data = {"type": "new_message", "sender_username": sender_username}

    user_id = f"user_{receiver_id}"
    send_notification(user_id, title, body, data)
