# Flask Chat App

## Overview

A real-time chat application with Flask + Socket.IO + Supabase. Users authenticate via JWT, establish a Socket.IO connection, and exchange messages in real time. Images are sent instantly as placeholders and uploaded in the background.

---

## Connection Flow: Client ↔ Server

### 1. Login → Get JWT

```
Client                           Server
POST /api/auth/login ────────►  Validate credentials
  { email, password }            Generate JWT (contains user_id, username)
                                 Return { access_token: "eyJ..." }
◄────────── JSON ──────────
                                 
Save token + user to localStorage
Redirect to /chat
```

### 2. Open Socket Connection

```
Client (globals.js)              Server (socket_events.py)
                                 
io({ auth: { token } })         @socketio.on("connect")
  │                              def handle_connect(auth):
  │   HTTP POST /socket.io/         decoded = decode_token(auth["token"])
  │   ?EIO=4&transport=polling      _add_connection(user_id, username, sid)
  │   &auth={"token":"eyJ..."}      emit("connected", {...})
  │                                socketio.emit("online_users_update")
  │   ◄── 200 { sid: "...", ... }
  │
  socket is now "connected"
  ready to emit/receive events
```

**Key:** The `auth` object in `io({ auth: { token } })` is NOT a regular emit. Socket.IO serializes it into the initial HTTP handshake request's query string. Engine.io unpacks it and flask-socketIO passes it as the `auth` parameter to `on("connect")`.

The server generates a **session id (sid)** during the handshake and sends it back. All subsequent `emit()` calls use this established connection.

---

## Message Flow: Sender → Receiver

```
Sender Client                     Server                         Receiver Client
                                  
socket.emit(                                              
  "private_message",              
  { to_user_id, content,
    media }             
) ──────────────────►  MessageService.save_message()
                        │── insert into "messages" table
                        │── insert into "message_media" rows
                        │
                        │  emit("message_sent", msg) 
                        │◄── for sender's sids
                        │
                        │  emit("new_message", msg)
                        │──────────────────────────────► appendMessage(msg)
                        │                                  (if activeUserId
                        │                                   matches sender)
                        │
                        │  emit("new_message", msg)
                        ──► (if sender is viewing
                             another chat, just
                             update unread badge)
```

### Media Upload Flow

```
Sender                              Server

1. Upload files to Flask first:
   POST /api/chat/upload-media ──►  Flask reads file
   (one per image)                  uploads to Supabase Storage
   ◄──── { file_path, ... } ─────   returns real file_path

2. Send message with real paths:
   socket.emit("private_message") ──►  save_message()
     { content, media: [              inserts into messages +
       { file_path, file_name,         message_media tables
         file_size, file_type }
     ] }                           
                                     emit("message_sent") ──► Sender
                                     emit("new_message")  ──► Receiver
```

---

## Event Reference

| Event | Direction | Purpose |
|---|---|---|
| `connect` | Client → Server | Handshake with JWT auth |
| `disconnect` | Client → Server | Cleanup on tab close |
| `private_message` | Client → Server | Send a message (with real file_paths from pre-upload) |
| `message_sent` | Server → Sender | Confirmation of sent message |
| `new_message` | Server → Receiver | Incoming message |
| `typing` / `stop_typing` | Client → Server → Other | Typing indicator relay |
| `online_users_update` | Server → All | Broadcast online status changes |
| `messages_read` | Server → Sender | Notify read receipts |

---

## File Structure

```
app/
├── chat/
│   ├── routes.py           # REST: users, history, upload-media, mark-read
│   └── socket_events.py    # All Socket.IO event handlers
├── services/
│   └── message_service.py  # DB operations: save, get, update_media_path
├── static/
│   ├── js/
│   │   ├── globals.js      # token, me, socket instance, shared state
│   │   ├── helpers.js      # escapeHtml, compressImage, avatarColor
│   │   ├── send-message.js # Send button handler, media queue
│   │   ├── conversation.js # appendMessage, selectUser, loadMore
│   │   ├── socket-handlers.js # All socket event listeners
│   │   ├── media.js        # File picker, preview, lightbox
│   │   ├── sidebar.js      # User list, search, status dots
│   │   ├── video-call.js   # WebRTC call handling
│   │   ├── profile.js      # Profile picture upload
│   │   └── idle.js         # Session timeout modal
│   └── css/
│       └── style.css
└── templates/
    └── chat.html           # Main chat UI
```

---

## Key Design Decisions

| Decision | Reason |
|---|---|
| Socket.IO with `async_mode="threading"` | Render (Python 3.14) doesn't support eventlet/gevent |
| Messages via socket, history via REST | Socket for real-time, REST for paginated history |
| Upload files first via Flask (service role), then send message | Simple, reliable, no RLS config needed |
