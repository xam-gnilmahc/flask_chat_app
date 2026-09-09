"""
Chat REST routes.

These complement the realtime socket events:
 - GET /api/chat/users         -> everyone + who's online right now
 - GET /api/chat/history/<id>  -> past messages with a given user
"""

import uuid
import os
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.services.user_service import UserService
from app.services.message_service import MessageService
from app.chat.socket_events import chat_socket_manager
from app.supabase_client import get_supabase

MEDIA_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")


def allowed_media(name):
    """Check file extension is in allowed image types."""
    return "." in name and name.rsplit(".", 1)[1].lower() in MEDIA_EXTENSIONS


chat_bp = Blueprint("chat", __name__, url_prefix="/api/chat")


@chat_bp.route("/users", methods=["GET"])
@jwt_required()
def list_users():
    """Return all users except current user, tagged with online status."""
    current_user_id = int(get_jwt_identity())
    online_ids = chat_socket_manager.get_online_user_ids()
    users = UserService.list_users_with_status(current_user_id, online_ids)
    online_count = len(online_ids - {current_user_id})
    return jsonify(
        {
            "users": users,
            "online_count": online_count,
        }
    ), 200


@chat_bp.route("/history/<int:other_user_id>", methods=["GET"])
@jwt_required()
def history(other_user_id):
    """Get paginated conversation history between current user and another user."""
    current_user_id = int(get_jwt_identity())
    before_id = request.args.get("before", type=int)
    result = MessageService.get_conversation(
        current_user_id, other_user_id, before_id=before_id
    )
    return jsonify(result), 200


@chat_bp.route("/unread-counts", methods=["GET"])
@jwt_required()
def unread_counts():
    """Return dict of {sender_id: unread_count} for current user."""
    user_id = int(get_jwt_identity())
    counts = MessageService.get_unread_counts(user_id)
    return jsonify(counts), 200


@chat_bp.route("/mark-read/<int:sender_id>", methods=["POST"])
@jwt_required()
def mark_read(sender_id):
    """Mark messages as read and notify the sender via socket."""
    current_user_id = int(get_jwt_identity())
    MessageService.mark_as_read(receiver_id=current_user_id, sender_id=sender_id)
    # Notify the sender that their messages were read
    payload = {"read_by": current_user_id}
    for sid in chat_socket_manager._sids_for_user(sender_id):
        chat_socket_manager.socketio.emit("messages_read", payload, room=sid)
    return jsonify({"message": "Marked as read"}), 200


@chat_bp.route("/upload-media", methods=["POST"])
@jwt_required()
def upload_media():
    """Upload an image to Supabase Storage. Accepts multipart file, returns file_path."""
    user_id = int(get_jwt_identity())
    if "file" not in request.files:
        return jsonify({"error": "No file"}), 400
    file = request.files["file"]
    if not file.filename or not allowed_media(file.filename):
        return jsonify({"error": "File type not allowed"}), 400

    file.seek(0, 2)
    size = file.tell()
    file.seek(0)
    if size > 5 * 1024 * 1024:
        return jsonify({"error": "Image should not exceed 5MB."}), 400

    ext = file.filename.rsplit(".", 1)[1].lower()
    filename = f"{user_id}/{uuid.uuid4().hex}.{ext}"
    file_data = file.read()
    size = len(file_data)
    # Map content type for storage
    ctype_map = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
    }
    supabase = get_supabase()
    supabase.storage.from_("chat_media").upload(
        filename, file_data, {"content-type": ctype_map.get(ext, "image/png")}
    )

    return jsonify(
        {
            "file_path": filename,
            "file_type": "image",
            "file_name": file.filename,
            "file_size": size,
        }
    ), 200


@chat_bp.route("/beams-token", methods=["GET", "POST"])
@jwt_required()
def beams_token():
    """Return Pusher Beams auth token for the current user."""
    from app.pusher_service import generate_beams_token

    user_id = int(get_jwt_identity())
    beams_token = generate_beams_token(user_id)
    return jsonify({"token": beams_token}), 200


@chat_bp.route("/beams-config", methods=["GET"])
@jwt_required()
def beams_config():
    """Return Pusher Beams instance ID."""
    from app.pusher_service import get_instance_id

    instance_id = get_instance_id()
    return jsonify({"instance_id": instance_id}), 200
