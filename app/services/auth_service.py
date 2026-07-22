from flask_jwt_extended import create_access_token
from werkzeug.security import generate_password_hash, check_password_hash

from app.services.user_service import UserService


class AuthError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class AuthService:

    @staticmethod
    def register(username: str, email: str, password: str) -> dict:
        if not username or not email or not password:
            raise AuthError("username, email and password are all required")

        if UserService.get_by_username(username):
            raise AuthError("Username is already taken", 409)

        if UserService.get_by_email(email):
            raise AuthError("Email is already registered", 409)

        password_hash = generate_password_hash(password)
        user = UserService.create_user(username, email, password_hash)
        return user

    @staticmethod 
    def authenticate(username: str, password: str) -> dict:
        user = UserService.get_by_username(username)
        if user is None or not check_password_hash(user["password_hash"], password):
            raise AuthError("Invalid username or password", 401)
        if user.get("status", 1) != 1:
            raise AuthError("Account is inactive. Contact support.", 403)
        return user

    @staticmethod
    def generate_token(user: dict) -> str:
        return create_access_token(
            identity=str(user["id"]),
            additional_claims={
                "username": user["username"],
                "token_version": user.get("token_version", 0),
            },
        )
