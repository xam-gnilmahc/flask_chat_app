import uuid, os, time, threading
from werkzeug.utils import secure_filename

def _safe_user(user: dict) -> dict:
    return {k: v for k, v in user.items() if k != "password_hash"}


from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.services import AuthService, AuthError
from app.services.user_service import UserService
from app.supabase_client import get_supabase

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp", "gif"}

def allowed_file(name):
    return "." in name and name.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

# ---- Rate limiter for login (per-IP) ----
_login_attempts = {}  # ip -> {"count": int, "lockout_until": float}
_login_lock = threading.Lock()
MAX_ATTEMPTS = 3
LOCKOUT_SECONDS = 60


def _get_ip():
    return request.headers.get("X-Forwarded-For", request.remote_addr or "unknown")


def _is_login_blocked(ip):
    with _login_lock:
        entry = _login_attempts.get(ip)
        if not entry:
            return False
        if time.time() < entry["lockout_until"]:
            return True
        if entry["count"] >= MAX_ATTEMPTS:
            _login_attempts.pop(ip, None)
            return False
        return False


def _record_failed_attempt(ip):
    with _login_lock:
        now = time.time()
        entry = _login_attempts.get(ip)
        if entry:
            entry["count"] += 1
            if entry["count"] >= MAX_ATTEMPTS:
                entry["lockout_until"] = now + LOCKOUT_SECONDS
        else:
            _login_attempts[ip] = {"count": 1, "lockout_until": 0}


def _reset_attempts(ip):
    with _login_lock:
        _login_attempts.pop(ip, None)


# Periodically clean stale entries to avoid memory bloat
def _cleanup_attempts():
    now = time.time()
    with _login_lock:
        expired = [ip for ip, e in _login_attempts.items()
                   if now >= e["lockout_until"] and e["count"] >= MAX_ATTEMPTS]
        for ip in expired:
            del _login_attempts[ip]


threading.Thread(target=_cleanup_attempts, daemon=True).start()

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@auth_bp.route("/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}
    try:
        user = AuthService.register(
            username=data.get("username", "").strip(),
            email=data.get("email", "").strip(),
            password=data.get("password", ""),
        )
        return jsonify({"message": "Registered successfully", "user": _safe_user(user)}), 201
    except AuthError as e:
        return jsonify({"error": e.message}), e.status_code


@auth_bp.route("/login", methods=["POST"])
def login():
    ip = _get_ip()

    if _is_login_blocked(ip):
        return jsonify({"error": "Too many attempts. Try again in 1 minute."}), 429

    data = request.get_json(silent=True) or {}
    try:
        user = AuthService.authenticate(
            username=data.get("username", "").strip(),
            password=data.get("password", ""),
        )
        _reset_attempts(ip)
        token = AuthService.generate_token(user)
        return jsonify({
            "message": "Login successful",
            "access_token": token,
            "user": _safe_user(user),
        }), 200
    except AuthError as e:
        _record_failed_attempt(ip)
        return jsonify({"error": e.message}), e.status_code


@auth_bp.route("/me", methods=["GET"])
@jwt_required()
def me():
    user_id = int(get_jwt_identity())
    user = UserService.get_by_id(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify({"user": _safe_user(user)}), 200


@auth_bp.route("/expire-session", methods=["POST"])
@jwt_required()
def expire_session():
    user_id = int(get_jwt_identity())
    UserService.increment_token_version(user_id)
    return jsonify({"message": "Session expired"}), 200


@auth_bp.route("/upload-profile-pic", methods=["POST"])
@jwt_required()
def upload_profile_pic():
    user_id = int(get_jwt_identity())
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files["file"]
    if not file.filename or not allowed_file(file.filename):
        return jsonify({"error": "Invalid file type (png, jpg, webp, gif only)"}), 400

    ext = file.filename.rsplit(".", 1)[1].lower()
    filename = f"{user_id}/{uuid.uuid4().hex}.{ext}"
    supabase = get_supabase()
    supabase.storage.from_("profiles").upload(filename, file.read(), {"content-type": file.content_type})
    user = UserService.get_by_id(user_id)
    old = user.get("profile_pic")
    if old:
        try:
            supabase.storage.from_("profiles").remove([old])
        except Exception:
            pass
    UserService.update_profile_pic(user_id, filename)
    return jsonify({"profile_pic": filename}), 200
