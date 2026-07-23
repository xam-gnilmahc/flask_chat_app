from flask import Flask, render_template

from app.config import Config
from app.extensions import jwt, socketio


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    jwt.init_app(app)
    socketio.init_app(app)

    from app.auth import auth_bp
    from app.chat import chat_bp
    app.register_blueprint(auth_bp)
    app.register_blueprint(chat_bp)

    from app.chat import chat_socket_manager  # noqa: F401

    @app.route("/")
    def index():
        return render_template("login.html")

    @app.route("/chat")
    def chat_page():
        return render_template("chat.html")

    return app
