from flask import Flask, render_template, send_from_directory

from app.config import Config
from app.extensions import jwt, socketio, cors
from app.pusher_service import init_pusher


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    cors.init_app(app, resources={r"/api/*": {"origins": ["http://127.0.0.1:3000", "http://localhost:3000"]}})
    jwt.init_app(app)
    socketio.init_app(app)

    # Initialize Pusher Beams for push notifications
    init_pusher(
        instance_id=app.config.get("PUSHER_BEAMS_INSTANCE_ID", ""),
        secret_key=app.config.get("PUSHER_BEAMS_SECRET_KEY", ""),
    )

    from app.auth import auth_bp
    from app.chat import chat_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(chat_bp)

    @app.route("/")
    def index():
        return render_template("login.html")

    @app.route("/chat")
    def chat_page():
        return render_template("chat.html")

    # Serve service worker from root (scope must be "/" to control all pages)
    @app.route("/sw.js")
    def service_worker():
        return send_from_directory("static", "sw.js", mimetype="application/javascript")

    return app
