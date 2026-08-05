"""
ChatSocketManager — Real-Time Signaling & Messaging Server
═════════════════════════════════════════════════════════════

This is the BACKEND heart of all real-time features in the chat app.
It runs on Flask-SocketIO with async_mode="threading".

WHAT IT DOES:
  1. AUTHENTICATES socket connections using JWT (same token used for login)
  2. TRACKS which users are currently online (in-memory, thread-safe)
  3. BROADCASTS the online-users list whenever someone connects/disconnects
  4. RELAYS private messages between two connected users
  5. RELAYS video call signaling (SDP offers/answers, ICE candidates)
  6. PERSISTS every message to the database (in background thread)

THREAD SAFETY:
  Flask-SocketIO with async_mode="threading" means each event handler runs
  on a worker thread. A threading.Lock() guards the shared _sid_to_user
  and _user_to_sids dicts to prevent race conditions.

ARCHITECTURE — HOW SIGNALING WORKS:
  The server is a PURE RELAY for video calls. It does NOT inspect or modify
  any SDP or ICE data. It simply forwards payloads between the two peers.

  Device A (Caller)          Server (Relay)           Device B (Callee)
       │                         │                         │
       │── call_offer (SDP) ────>│── call_offer (SDP) ───>│
       │<── call_answer (SDP) ───│<── call_answer (SDP) ──│
       │── ice_candidate ───────>│── ice_candidate ──────>│
       │<── ice_candidate ───────│<── ice_candidate ──────│
       │                         │                         │
       │◀═══════════════ DIRECT P2P (video+audio) ═════════▶│

MULTI-TAB / MULTI-DEVICE SUPPORT:
  A single user can have multiple browser tabs or devices connected.
  Each tab gets its own socket SID. The server tracks:
    - _sid_to_user:  {sid → {user_id, username}}  — which user owns this SID
    - _user_to_sids: {user_id → {sid1, sid2, ...}} — all SIDs for this user

  When relaying messages/calls, the server sends to ALL SIDs for a user,
  so the message appears on all their connected devices.
"""

import threading
import base64
import time
import uuid
from datetime import datetime
from flask import request
from flask_socketio import emit, disconnect
from flask_jwt_extended import decode_token

from app.extensions import socketio
from app.services.message_service import MessageService
from app.services.user_service import UserService
from app.supabase_client import get_supabase
from app.pusher_service import send_message_notification


class ChatSocketManager:
    def __init__(self, socketio_instance):
        self.socketio = socketio_instance

        # ─── IN-MEMORY STATE ───────────────────────────────────────────────
        # These dicts track who is currently connected.
        # They are NOT persisted to a database — they reset when the server restarts.

        # Maps socket SID → {"user_id": int, "username": str}
        # Example: {"abc123": {"user_id": 42, "username": "john"}}
        self._sid_to_user = {}

        # Maps user_id → set of SIDs (a user can have multiple tabs/devices)
        # Example: {42: {"abc123", "def456"}}  → user 42 has 2 tabs open
        self._user_to_sids = {}

        # Maps user_id → chat_with_user_id
        # Tracks which chat each user is currently viewing (e.g. {42: 7})
        self._user_viewing = {}

        # Thread-safe lock — protects the dicts above from concurrent modification
        # (Flask-SocketIO runs each handler on a separate worker thread)
        self._lock = threading.Lock()

        # Register all socket event handlers
        self._register_handlers()

    # ═══════════════════════════════════════════════════════════════════════
    # PUBLIC HELPERS — Used by REST routes and other parts of the app
    # ═══════════════════════════════════════════════════════════════════════

    def get_online_user_ids(self):
        """
        Returns a set of user_ids that currently have at least one active socket connection.
        Used by REST routes to check if a specific user is online.
        """
        with self._lock:
            return set(self._user_to_sids.keys())

    def _build_online_users_payload(self):
        """
        Builds the full payload for the 'online_users_update' event.
        Returns a dict with:
          - online_count: total number of online users
          - online_users: list of full User objects (with id, username, profile_pic, etc.)
        This payload is sent to ALL connected clients whenever someone joins/leaves.
        """
        with self._lock:
            user_ids = list(self._user_to_sids.keys())

        # Fetch full user objects from the database for each online user
        users = [UserService.get_by_id(uid) for uid in user_ids]
        return {
            "online_count": len(users),
            "online_users": [u for u in users if u is not None],
        }

    # ═══════════════════════════════════════════════════════════════════════
    # INTERNAL HELPERS — Connection tracking and authentication
    # ═══════════════════════════════════════════════════════════════════════

    @staticmethod
    def _authenticate(auth):
        """
        Validates the JWT token sent by the client when opening a socket connection.

        HOW THE CLIENT CONNECTS:
          const socket = io(url, { auth: { token: "eyJhbGciOi..." } })

        WHAT HAPPENS:
          1. Extract the token from the auth dict
          2. Decode it using flask_jwt_extended
          3. If valid → returns decoded token dict (contains "sub" = user_id, "username")
          4. If invalid/expired → returns None (connection will be rejected)

        Returns:
          dict with decoded token data, or None if authentication fails
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
        """
        Registers a new socket connection for a user.

        Called when a socket CONNECTS. Supports multi-tab:
          - If user 42 opens a second tab, a new SID is added to their set
          - Both tabs will receive messages/calls meant for user 42

        Example:
          _add_connection(42, "john", "abc123")
          _add_connection(42, "john", "def456")  # second tab
          → _user_to_sids = {42: {"abc123", "def456"}}
        """
        with self._lock:
            self._sid_to_user[sid] = {"user_id": user_id, "username": username}
            self._user_to_sids.setdefault(user_id, set()).add(sid)

    def _remove_connection(self, sid):
        """
        Removes a socket connection when a socket DISCONNECTS.

        Called when a socket disconnects (tab closed, network drop, etc.).
        If the user has NO MORE SIDs after removal, they're considered offline.

        Returns:
          dict with user_id and username, or None if SID wasn't tracked
        """
        with self._lock:
            info = self._sid_to_user.pop(sid, None)
            if not info:
                return None
            user_id = info["user_id"]
            sids = self._user_to_sids.get(user_id)
            if sids:
                sids.discard(sid)
                # If user has no more connected tabs/devices, remove them from online list
                if not sids:
                    del self._user_to_sids[user_id]
            return info

    def _sids_for_user(self, user_id):
        """
        Returns ALL socket SIDs for a given user_id.

        WHY NEEDED:
          When relaying a message or call to user 42, we need to send it to
          ALL of user 42's connected tabs/devices, not just one.

        Returns:
          list of SID strings (empty list if user has no connections)
        """
        with self._lock:
            return list(self._user_to_sids.get(user_id, []))

    # ═══════════════════════════════════════════════════════════════════════
    # SOCKET EVENT HANDLERS — The actual event listeners
    # ═══════════════════════════════════════════════════════════════════════

    def _register_handlers(self):
        # ═══════════════════════════════════════════════════════════════════
        # EVENT: connect — A new client opens a socket connection
        # ═══════════════════════════════════════════════════════════════════
        #
        # WHAT HAPPENS:
        #   1. Client opens socket with JWT token in auth
        #   2. Server validates the JWT
        #   3. If valid → register the connection, notify everyone about online status
        #   4. If invalid → disconnect the client immediately
        #
        # WHAT THE CLIENT RECEIVES:
        #   - "connected" event with welcome message and user_id
        #   - "online_users_update" event with full list of online users
        # ═══════════════════════════════════════════════════════════════════
        @self.socketio.on("connect")
        def handle_connect(auth=None):
            # Step 1: Validate the JWT token
            decoded = self._authenticate(auth)
            if decoded is None:
                # Invalid or missing token — reject the connection
                disconnect()
                return False

            # Step 2: Extract user info from the decoded token
            user_id = int(decoded["sub"])  # "sub" claim = user_id
            username = decoded.get("username", "unknown")
            sid = request.sid  # Unique socket session ID

            # Step 3: Register this connection in our in-memory state
            self._add_connection(user_id, username, sid)

            # Step 4: Send a welcome message back to the connected client
            emit("connected", {"message": f"Welcome {username}!", "user_id": user_id})

            # Step 5: Broadcast updated online list to ALL connected clients
            # Every client receives this and updates their UI (green dot, etc.)
            self.socketio.emit(
                "online_users_update", self._build_online_users_payload()
            )

        # ═══════════════════════════════════════════════════════════════════
        # EVENT: disconnect — A client's socket connection is closed
        # ═══════════════════════════════════════════════════════════════════
        #
        # WHAT HAPPENS:
        #   1. Remove the SID from our tracking dicts
        #   2. If user has no more tabs/devices open → they're now offline
        #   3. Broadcast updated online list to all remaining clients
        #
        # COMMON CAUSES:
        #   - User closed the browser tab
        #   - User navigated to a different page
        #   - Network connection dropped
        #   - User logged out
        # ═══════════════════════════════════════════════════════════════════
        @self.socketio.on("disconnect")
        def handle_disconnect():
            sid = request.sid
            # Remove this SID from tracking — if user has no more SIDs, they're offline
            info = self._remove_connection(sid)
            if info:
                # Clean up viewing state
                with self._lock:
                    self._user_viewing.pop(info["user_id"], None)
                # Broadcast updated online list to all remaining clients
                self.socketio.emit(
                    "online_users_update", self._build_online_users_payload()
                )

        # ═══════════════════════════════════════════════════════════════════
        # EVENT: get_online_users — Client explicitly requests the online list
        # ═══════════════════════════════════════════════════════════════════
        #
        # WHY NEEDED:
        #   Sometimes the client needs to refresh the online list without
        #   waiting for a connect/disconnect event (e.g., after page load).
        # ═══════════════════════════════════════════════════════════════════
        @self.socketio.on("get_online_users")
        def handle_get_online_users():
            """Client can explicitly ask for a refresh of the online list."""
            emit("online_users_update", self._build_online_users_payload())

        # ═══════════════════════════════════════════════════════════════════
        # EVENT: private_message — Send a chat message to another user
        # ═══════════════════════════════════════════════════════════════════
        #
        # WHAT HAPPENS:
        #   1. Sender's browser emits "private_message" with {to_user_id, content, media}
        #   2. Server looks up all SIDs for the receiver
        #   3. Server emits "new_message" to the RECEIVER (so they see it)
        #   4. Server emits "message_sent" back to the SENDER (for confirmation)
        #   5. Server saves the message to the database in a BACKGROUND THREAD
        #      (so the UI doesn't wait for the DB write to complete)
        #
        # DEVICE A (Sender) sends → Server relays → DEVICE B (Receiver) receives
        # ═══════════════════════════════════════════════════════════════════
        @self.socketio.on("private_message")
        def handle_private_message(data):
            """Receive a private message from sender, relay to receiver + echo to sender, persist in background."""
            sid = request.sid
            sender_info = self._sid_to_user.get(sid)

            # Security: Only authenticated users can send messages
            if not sender_info:
                emit("error", {"message": "Not authenticated"})
                return

            # Extract message data from the payload
            to_user_id = data.get("to_user_id")
            content = (data.get("content") or "").strip()
            media = data.get("media")  # Optional: images/files attached to the message

            # Validate: must have a recipient
            if not to_user_id:
                emit("error", {"message": "to_user_id is required"})
                return

            sender_id = sender_info["user_id"]
            now = datetime.utcnow().isoformat() + "Z"  # ISO timestamp

            # Build the message payload that will be sent to both sender and receiver
            payload = {
                "sender_id": sender_id,
                "receiver_id": int(to_user_id),
                "content": content,
                "media": media,
                "sender_username": sender_info["username"],
                "timestamp": now,
            }

            # ─── RELAY TO RECEIVER ─────────────────────────────────────
            # Send "new_message" to ALL of the receiver's connected tabs/devices
            # This ensures the message appears on phone, laptop, etc.
            receiver_sids = self._sids_for_user(int(to_user_id))
            for receiver_sid in receiver_sids:
                self.socketio.emit("new_message", payload, room=receiver_sid)

            # ─── PUSH NOTIFICATION ────────────────────────────────────
            # Send push notification when:
            #   1. Receiver is OFFLINE (no socket) — they'll get notified when they return
            #   2. Receiver is ONLINE but NOT viewing this chat — like WhatsApp
            # Don't send if they're actively viewing this conversation (socket handles it)
            with self._lock:
                viewing_chat = self._user_viewing.get(int(to_user_id))
            if viewing_chat != sender_id:
                threading.Thread(
                    target=send_message_notification,
                    args=(int(to_user_id), sender_info["username"], content),
                    daemon=True,
                ).start()

            # ─── CONFIRM TO SENDER ────────────────────────────────────
            # Send "message_sent" back to ALL of the sender's connected tabs/devices
            # This lets the sender's UI know the message was delivered
            for sender_sid in self._sids_for_user(sender_id):
                self.socketio.emit("message_sent", payload, room=sender_sid)

            # ─── PERSIST TO DATABASE (Background Thread) ───────────────
            # Save the message to Supabase in a background thread
            # This way the UI responds instantly without waiting for DB write
            threading.Thread(
                target=_save_message_thread,
                args=(sender_id, int(to_user_id), content, media),
                daemon=True,  # Thread dies automatically when main app exits
            ).start()

        # ═══════════════════════════════════════════════════════════════════
        # EVENT: typing — User is typing a message (show "..." indicator)
        # ═══════════════════════════════════════════════════════════════════
        #
        # WHAT HAPPENS:
        #   Device A types → emits "typing" → Server relays to Device B
        #   Device B sees "John is typing..." indicator
        # ═══════════════════════════════════════════════════════════════════
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
            # Send typing indicator to ALL of the recipient's connected tabs
            for receiver_sid in self._sids_for_user(int(to_user_id)):
                self.socketio.emit(
                    "typing",
                    {
                        "from_user_id": sender_info["user_id"],
                        "username": sender_info["username"],
                    },
                    room=receiver_sid,
                )

        # ═══════════════════════════════════════════════════════════════════
        # EVENT: stop_typing — User stopped typing (hide "..." indicator)
        # ═══════════════════════════════════════════════════════════════════
        #
        # WHAT HAPPENS:
        #   Device A stops typing → emits "stop_typing" → Server relays to Device B
        #   Device B hides the "John is typing..." indicator
        # ═══════════════════════════════════════════════════════════════════
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

        # ═══════════════════════════════════════════════════════════════════
        # EVENT: viewing_chat — User opened a chat conversation
        # ═══════════════════════════════════════════════════════════════════
        #
        # WHAT HAPPENS:
        #   Device A opens chat with User B → emits "viewing_chat"
        #   Server records that User A is currently viewing chat with User B
        #   Used to decide push notification: if online but NOT viewing → notify
        # ═══════════════════════════════════════════════════════════════════
        @self.socketio.on("viewing_chat")
        def handle_viewing_chat(data):
            """Track which chat the user is currently viewing."""
            sid = request.sid
            sender_info = self._sid_to_user.get(sid)
            if not sender_info:
                return
            chat_with = data.get("chat_with_user_id")
            with self._lock:
                self._user_viewing[sender_info["user_id"]] = int(chat_with) if chat_with else None

        # ═══════════════════════════════════════════════════════════════════
        # EVENT: leave_chat — User closed/left a chat conversation
        # ═══════════════════════════════════════════════════════════════════
        @self.socketio.on("leave_chat")
        def handle_leave_chat():
            """Clear the user's current chat viewing state."""
            sid = request.sid
            sender_info = self._sid_to_user.get(sid)
            if not sender_info:
                return
            with self._lock:
                self._user_viewing.pop(sender_info["user_id"], None)

        # ═══════════════════════════════════════════════════════════════════
        # EVENT: call_offer — Device A wants to start a video call with Device B
        # ═══════════════════════════════════════════════════════════════════
        #
        # DEVICE A (Caller) perspective:
        #   1. User clicks "Call" button
        #   2. Browser captures camera + mic
        #   3. Browser creates SDP Offer (video/audio capabilities)
        #   4. Browser emits: socket.emit("call_offer", {to_user_id, sdp})
        #
        # SERVER action:
        #   1. Receives the SDP offer from Device A
        #   2. Looks up ALL SIDs for Device B
        #   3. Forwards the offer to Device B with added from_user_id and username
        #
        # DEVICE B (Callee) receives:
        #   1. Gets "call_offer" event with {from_user_id, username, sdp}
        #   2. Shows incoming call popup with caller's name + avatar
        # ═══════════════════════════════════════════════════════════════════
        @self.socketio.on("call_offer")
        def handle_call_offer(data):
            sender_info = self._sid_to_user.get(request.sid)
            if not sender_info:
                return
            to_user_id = data.get("to_user_id")
            # Relay the SDP offer to ALL of Device B's connected tabs/devices
            for sid in self._sids_for_user(int(to_user_id)):
                self.socketio.emit(
                    "call_offer",
                    {
                        "from_user_id": sender_info["user_id"],  # Who is calling
                        "username": sender_info["username"],  # For display in popup
                        "sdp": data["sdp"],  # The SDP offer (unmodified)
                    },
                    room=sid,
                )

        # ═══════════════════════════════════════════════════════════════════
        # EVENT: call_answer — Device B accepted the call, here's their SDP Answer
        # ═══════════════════════════════════════════════════════════════════
        #
        # DEVICE B (Callee) perspective:
        #   1. User clicks "Accept" on incoming call popup
        #   2. Browser captures camera + mic
        #   3. Browser sets Device A's SDP Offer as remote description
        #   4. Browser creates SDP Answer (Device B's capabilities)
        #   5. Browser emits: socket.emit("call_answer", {to_user_id, sdp})
        #
        # SERVER action:
        #   1. Receives the SDP answer from Device B
        #   2. Looks up ALL SIDs for Device A
        #   3. Forwards the answer to Device A with added from_user_id
        #
        # DEVICE A (Caller) receives:
        #   1. Gets "call_answer" event with {from_user_id, sdp}
        #   2. Sets Device B's answer as remote description
        #   3. ICE connectivity checks begin automatically
        #   4. Once a working path is found → P2P connection is live!
        # ═══════════════════════════════════════════════════════════════════
        @self.socketio.on("call_answer")
        def handle_call_answer(data):
            sender_info = self._sid_to_user.get(request.sid)
            if not sender_info:
                return
            to_user_id = data.get("to_user_id")
            # Relay the SDP answer to ALL of Device A's connected tabs/devices
            for sid in self._sids_for_user(int(to_user_id)):
                self.socketio.emit(
                    "call_answer",
                    {
                        "from_user_id": sender_info["user_id"],  # Who answered
                        "sdp": data["sdp"],  # The SDP answer (unmodified)
                    },
                    room=sid,
                )

        # ═══════════════════════════════════════════════════════════════════
        # EVENT: ice_candidate — A device discovered a new network route
        # ═══════════════════════════════════════════════════════════════════
        #
        # WHAT ARE ICE CANDIDATES?
        #   Each candidate is a potential network path (IP:port) that the browser
        #   discovered. Devices exchange candidates to find the BEST path to connect.
        #
        # FLOW:
        #   Device A discovers candidate → emits "ice_candidate" → Server relays → Device B adds it
        #   Device B discovers candidate → emits "ice_candidate" → Server relays → Device A adds it
        #   Both devices try all candidate pairs until they find one that works
        #
        # NOTE: This happens CONTINUOUSLY during call setup, in parallel with SDP exchange.
        #       Multiple candidates may be exchanged before a working path is found.
        # ═══════════════════════════════════════════════════════════════════
        @self.socketio.on("ice_candidate")
        def handle_ice_candidate(data):
            sender_info = self._sid_to_user.get(request.sid)
            if not sender_info:
                return
            to_user_id = data.get("to_user_id")
            # Relay the ICE candidate to ALL of the other device's connected tabs
            for sid in self._sids_for_user(int(to_user_id)):
                self.socketio.emit(
                    "ice_candidate",
                    {
                        "from_user_id": sender_info[
                            "user_id"
                        ],  # Who sent this candidate
                        "candidate": data[
                            "candidate"
                        ],  # The ICE candidate (unmodified)
                    },
                    room=sid,
                )

        # ═══════════════════════════════════════════════════════════════════
        # EVENT: end_call — One device hung up, notify the other device
        # ═══════════════════════════════════════════════════════════════════
        #
        # WHAT HAPPENS:
        #   Device A clicks "End Call" → emits "end_call" → Server relays as "call_ended"
        #   Device B receives "call_ended" → closes its P2P connection → cleans up UI
        #
        # NOTE: The event name changes from "end_call" (client → server) to
        #       "call_ended" (server → client) to avoid confusion between
        #       the action of ending and the notification that it ended.
        # ═══════════════════════════════════════════════════════════════════
        @self.socketio.on("end_call")
        def handle_end_call(data):
            sender_info = self._sid_to_user.get(request.sid)
            if not sender_info:
                return
            to_user_id = data.get("to_user_id")
            # Notify ALL of the other device's tabs that the call has ended
            for sid in self._sids_for_user(int(to_user_id)):
                self.socketio.emit(
                    "call_ended",
                    {
                        "from_user_id": sender_info["user_id"],  # Who ended the call
                    },
                    room=sid,
                )

        # ═══════════════════════════════════════════════════════════════════
        # EVENT: change_bg_image — User changed chat background, notify the other user
        # ═══════════════════════════════════════════════════════════════════
        #
        # WHAT HAPPENS:
        #   Device A picks a new background image → emits "change_bg_image"
        #   Server relays "bg_image_changed" to Device B
        #   Device B updates their chat background to match
        #
        # This keeps both users' chat backgrounds in sync.
        # ═══════════════════════════════════════════════════════════════════
        @self.socketio.on("change_bg_image")
        def handle_change_bg_image(data):
            """Handle background image change and broadcast to the other user."""
            sid = request.sid
            sender_info = self._sid_to_user.get(sid)
            if not sender_info:
                return
            to_user_id = data.get("to_user_id")
            image_url = data.get("image_url")
            if not to_user_id:
                return
            # Relay the background change to ALL of the other user's connected tabs
            for receiver_sid in self._sids_for_user(int(to_user_id)):
                self.socketio.emit(
                    "bg_image_changed",
                    {
                        "from_user_id": sender_info["user_id"],
                        "image_url": image_url,
                    },
                    room=receiver_sid,
                )


# ═══════════════════════════════════════════════════════════════════════════════
# SINGLETON INSTANCE — Shared across the entire app
# ═══════════════════════════════════════════════════════════════════════════════
# This instance is:
#   - Imported by app/__init__.py to register all socket handlers
#   - Imported by chat/routes.py to read the live online-users state
chat_socket_manager = ChatSocketManager(socketio)


# ═══════════════════════════════════════════════════════════════════════════════
# BACKGROUND THREAD — Save message to database without blocking the UI
# ═══════════════════════════════════════════════════════════════════════════════
#
# WHY A BACKGROUND THREAD?
#   Database writes can take 100-500ms. If we did this in the event handler,
#   the UI would freeze for that duration. By running in a background thread,
#   the message appears instantly on the recipient's screen, and the DB write
#   happens silently in the background.
#
# WHAT HAPPENS:
#   1. Save the message text to the "messages" table
#   2. If the message has media (images/files):
#      a. Decode the base64 data
#      b. Upload the file to Supabase Storage ("chat_media" bucket)
#      c. Insert a record into "message_media" table linking to the message
#   3. If the receiver is currently online, mark the message as read immediately
# ═══════════════════════════════════════════════════════════════════════════════
def _save_message_thread(sender_id, receiver_id, content, media):
    try:
        supabase = get_supabase()

        # Step 1: Save the message text to the database
        message = MessageService.save_message(
            sender_id=sender_id,
            receiver_id=receiver_id,
            content=content,
        )

        # Step 2: If there are media attachments, upload them
        if message and media:
            records = []
            for m in media:
                raw_data = m.pop("data", None)
                if not raw_data:
                    # No base64 data — just store the metadata as-is
                    records.append(m)
                    continue
                try:
                    # Decode base64 image/file data
                    b64 = raw_data.split(",")[1] if "," in raw_data else raw_data
                    raw = base64.b64decode(b64)

                    # Generate a unique file path: {user_id}/{timestamp}_{random}.ext
                    ext = (m.get("file_name") or "image.jpg").rsplit(".", 1)[
                        -1
                    ] or "jpg"
                    file_path = f"{sender_id}/{int(time.time() * 1000)}_{uuid.uuid4().hex}.{ext}"

                    # Upload to Supabase Storage
                    supabase.storage.from_("chat_media").upload(
                        file_path,
                        raw,
                        {"content-type": "image/jpeg", "upsert": "false"},
                    )

                    # Store the file path and link it to the message
                    m["file_path"] = file_path
                    m["message_id"] = message["id"]
                    records.append(m)
                except Exception:
                    pass  # Silently skip failed uploads

            # Insert all media records into the database
            if records:
                supabase.table("message_media").insert(records).execute()

        # NOTE: Messages are only marked as read when the receiver OPENS the chat
        # (via the /api/chat/mark-read endpoint called from the client).
        # NOT when they're just online.

    except Exception:
        pass  # Silently handle any errors (message is already delivered via socket)
