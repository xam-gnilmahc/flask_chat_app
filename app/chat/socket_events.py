"""
ChatSocketManager

Encapsulates ALL real-time behaviour in one class:
  - authenticating the socket connection using the same JWT issued at login
  - tracking which users are currently online (in-memory, thread-safe)
  - broadcasting the online-users list whenever it changes
  - relaying private messages between two connected users
  - persisting every message via MessageService (backup) and Supabase Edge Function (primary)

Flask-SocketIO is configured with async_mode="threading" (see extensions.py),
so every event handler here effectively runs on a worker thread. A lock
guards the shared online-users dict for that reason.
"""

import threading, json, base64, time, uuid
from datetime import datetime
from flask import request
from flask_socketio import emit, disconnect
from flask_jwt_extended import decode_token

from app.extensions import socketio
from app.services.message_service import MessageService
from app.services.user_service import UserService
from app.supabase_client import get_supabase


class ChatSocketManager:
    def __init__(self, socketio_instance):
        self.socketio = socketio_instance
        # sid -> {"user_id": int, "username": str}
        self._sid_to_user = {}
        # user_id -> set of sids (a user could have multiple tabs/devices open)
        self._user_to_sids = {}
        self._lock = threading.Lock()

        self._register_handlers()

    # ------------------------------------------------------------------
    # Public helpers used elsewhere (e.g. REST routes)
    # ------------------------------------------------------------------

    def get_online_user_ids(self):
        """Return set of user_ids that currently have active socket connections."""
        with self._lock:
            return set(self._user_to_sids.keys())

    def _build_online_users_payload(self):
        """Build the payload for online_users_update event with full user objects."""
        with self._lock:
            user_ids = list(self._user_to_sids.keys())
        users = [UserService.get_by_id(uid) for uid in user_ids]
        return {
            "online_count": len(users),
            "online_users": [u for u in users if u is not None],
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _authenticate(auth):
        """
        Validate the JWT sent by the client when opening the socket
        connection. The client should send: io(url, { auth: { token } })
        Returns the decoded token dict, or None if invalid.
        """
        token = None
        if auth and isinstance(auth, dict):
            token = auth.get("token")

        if not token:
            return None
        try:
            decoded = decode_token(token)
            return decoded
        except Exception:
            return None

    def _add_connection(self, user_id, username, sid):
        """Register a socket SID for a user (supports multi-tab)."""
        with self._lock:
            self._sid_to_user[sid] = {"user_id": user_id, "username": username}
            self._user_to_sids.setdefault(user_id, set()).add(sid)

    def _remove_connection(self, sid):
        """Remove a socket SID; if user has no more SIDs, remove them from online list."""
        with self._lock:
            info = self._sid_to_user.pop(sid, None)
            if not info:
                return None
            user_id = info["user_id"]
            sids = self._user_to_sids.get(user_id)
            if sids:
                sids.discard(sid)
                if not sids:
                    del self._user_to_sids[user_id]
            return info

    def _sids_for_user(self, user_id):
        """Return all socket SIDs for a user (they may have multiple tabs open)."""
        with self._lock:
            return list(self._user_to_sids.get(user_id, []))

    # ------------------------------------------------------------------
    # SocketIO event handlers
    # ------------------------------------------------------------------

    def  _register_handlers(self):

        @self.socketio.on("connect")
        def handle_connect(auth=None):
            decoded = self._authenticate(auth)
            if decoded is None:
                # Reject unauthenticated socket connections
                disconnect()
                return False

            user_id = int(decoded["sub"])
            username = decoded.get("username", "unknown")
            sid = request.sid

            self._add_connection(user_id, username, sid)

            emit("connected", {"message": f"Welcome {username}!", "user_id": user_id})

            # Let everyone know the online list just changed
            self.socketio.emit("online_users_update", self._build_online_users_payload())

        @self.socketio.on("disconnect")
        def handle_disconnect():
            sid = request.sid
            info = self._remove_connection(sid)
            if info:
                self.socketio.emit("online_users_update", self._build_online_users_payload())

        @self.socketio.on("get_online_users")
        def handle_get_online_users():
            """Client can explicitly ask for a refresh of the online list."""
            emit("online_users_update", self._build_online_users_payload())

        @self.socketio.on("private_message")
        def handle_private_message(data):
            """Receive a private message from sender, relay to receiver + echo to sender, persist in background."""
            sid = request.sid
            sender_info = self._sid_to_user.get(sid)
            if not sender_info:
                emit("error", {"message": "Not authenticated"})
                return

            to_user_id = data.get("to_user_id")
            content = (data.get("content") or "").strip()
            media = data.get("media")

            if not to_user_id:
                emit("error", {"message": "to_user_id is required"})
                return

            sender_id = sender_info["user_id"]
            now = datetime.utcnow().isoformat() + "Z"

            payload = {
                "sender_id": sender_id,
                "receiver_id": int(to_user_id),
                "content": content,
                "media": media,
                "sender_username": sender_info["username"],
                "timestamp": now,
            }

            for receiver_sid in self._sids_for_user(int(to_user_id)):
                self.socketio.emit("new_message", payload, room=receiver_sid)

            for sender_sid in self._sids_for_user(sender_id):
                self.socketio.emit("message_sent", payload, room=sender_sid)

            # Save to DB in background thread
            threading.Thread(
                target=_save_message_thread,
                args=(sender_id, int(to_user_id), content, media),
                daemon=True,
            ).start()

        @self.socketio.on("typing")
        def handle_typing(data):
            """Relay a 'user is typing' indicator to the recipient."""
            sid = request.sid
            sender_info = self._sid_to_user.get(sid)
            if not sender_info:
                return
            to_user_id = data.get("to_user_id")
            if not to_user_id:
                return
            for receiver_sid in self._sids_for_user(int(to_user_id)):
                self.socketio.emit(
                    "typing",
                    {"from_user_id": sender_info["user_id"], "username": sender_info["username"]},
                    room=receiver_sid,
                )

        @self.socketio.on("stop_typing")
        def handle_stop_typing(data):
            """Relay a 'user stopped typing' indicator to the recipient."""
            sid = request.sid
            sender_info = self._sid_to_user.get(sid)
            if not sender_info:
                return
            to_user_id = data.get("to_user_id")
            if not to_user_id:
                return
            for receiver_sid in self._sids_for_user(int(to_user_id)):
                self.socketio.emit(
                    "stop_typing",
                    {"from_user_id": sender_info["user_id"]},
                    room=receiver_sid,
                )

        @self.socketio.on("call_offer")
        def handle_call_offer(data):
            sender_info = self._sid_to_user.get(request.sid)
            if not sender_info:
                return
            to_user_id = data.get("to_user_id")
            for sid in self._sids_for_user(int(to_user_id)):
                self.socketio.emit("call_offer", {
                    "from_user_id": sender_info["user_id"],
                    "username": sender_info["username"],
                    "sdp": data["sdp"],
                }, room=sid)

        @self.socketio.on("call_answer")
        def handle_call_answer(data):
            sender_info = self._sid_to_user.get(request.sid)
            if not sender_info:
                return
            to_user_id = data.get("to_user_id")
            for sid in self._sids_for_user(int(to_user_id)):
                self.socketio.emit("call_answer", {
                    "from_user_id": sender_info["user_id"],
                    "sdp": data["sdp"],
                }, room=sid)

        @self.socketio.on("ice_candidate")
        def handle_ice_candidate(data):
            sender_info = self._sid_to_user.get(request.sid)
            if not sender_info:
                return
            to_user_id = data.get("to_user_id")
            for sid in self._sids_for_user(int(to_user_id)):
                self.socketio.emit("ice_candidate", {
                    "from_user_id": sender_info["user_id"],
                    "candidate": data["candidate"],
                }, room=sid)

        @self.socketio.on("end_call")
        def handle_end_call(data):
            sender_info = self._sid_to_user.get(request.sid)
            if not sender_info:
                return
            to_user_id = data.get("to_user_id")
            for sid in self._sids_for_user(int(to_user_id)):
                self.socketio.emit("call_ended", {
                    "from_user_id": sender_info["user_id"],
                }, room=sid)


# Single shared instance, wired up to the app's socketio object.
# Imported by app/__init__.py (to make sure handlers register) and by
# chat/routes.py (to read the live online-users state).
chat_socket_manager = ChatSocketManager(socketio)


# Save message to DB → upload media to storage → insert media records
# Runs in background thread so UI stays instant
def _save_message_thread(sender_id, receiver_id, content, media):
    try:
        supabase = get_supabase()
        message = MessageService.save_message(
            sender_id=sender_id, receiver_id=receiver_id,
            content=content,
        )
        if message and media:
            records = []
            for m in media:
                raw_data = m.pop("data", None)
                if not raw_data:
                    records.append(m)
                    continue
                try:
                    b64 = raw_data.split(",")[1] if "," in raw_data else raw_data
                    raw = base64.b64decode(b64)
                    ext = (m.get("file_name") or "image.jpg").rsplit(".", 1)[-1] or "jpg"
                    file_path = f"{sender_id}/{int(time.time() * 1000)}_{uuid.uuid4().hex}.{ext}"
                    supabase.storage.from_("chat_media").upload(
                        file_path, raw,
                        {"content-type": "image/jpeg", "upsert": "false"}
                    )
                    m["file_path"] = file_path
                    m["message_id"] = message["id"]
                    records.append(m)
                except Exception:
                    pass
            if records:
                supabase.table("message_media").insert(records).execute()
        # If receiver is online, mark message as read immediately
        if chat_socket_manager._sids_for_user(receiver_id):
            supabase.table("messages").update({"is_read": True}).eq("id", message["id"]).execute()
    except Exception:
        pass
