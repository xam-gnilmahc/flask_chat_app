from flask_jwt_extended import JWTManager, get_jwt
from flask_socketio import SocketIO
from app.services.user_service import UserService

jwt = JWTManager()

socketio = SocketIO(cors_allowed_origins=[], max_http_buffer_size=20 * 1024 * 1024)


@jwt.token_in_blocklist_loader
def check_token_version(jwt_header, jwt_payload):
    user_id = int(jwt_payload["sub"])
    token_version = jwt_payload.get("token_version", 0)
    user = UserService.get_by_id(user_id)
    if not user:
        return True
    return user.get("token_version", 0) != token_version
