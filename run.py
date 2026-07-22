"""
Entry point.

Run with:  python run.py
This starts Flask-SocketIO's own server (built on Werkzeug's dev server),
using async_mode="threading" as configured in app/extensions.py — so no
eventlet/gevent installation is required.
"""

from app import create_app
from app.extensions import socketio

app = create_app()

if __name__ == "__main__":
    # allow_unsafe_werkzeug=True lets Werkzeug's dev server run outside of
    # Flask's reloader-guarded main process. Fine for local development;
    # use a production WSGI/ASGI server (gunicorn + eventlet, etc.) for
    # real deployments.
    socketio.run(app, host="0.0.0.0", port=5000, debug=True, allow_unsafe_werkzeug=True)
