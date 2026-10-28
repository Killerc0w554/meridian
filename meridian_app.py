#!/usr/bin/python3
"""Meridian desktop app: a native GTK 3 window around the calendar UI.

The interface is served to an embedded WebKit view. It keeps the original
private URI scheme so existing appointments retain their local-storage origin,
with persistent data under ~/.local/share/meridian/. No local web server is
involved.
"""

from __future__ import annotations

import json
import mimetypes
import os
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

import gi

gi.require_version("Gdk", "3.0")
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")

from gi.repository import Gdk, Gio, GLib, Gtk, WebKit2  # noqa: E402

APP_ID = "com.meridian.Meridian"
APP_NAME = "Meridian"
# Legacy internal scheme. Keeping it preserves the local-storage origin, so
# appointments saved before the rename stay visible.
SCHEME = "callendar"
HOST = "app"
START_PAGE = "index.html"
DEFAULT_SIZE = (1280, 860)

BASE_DIR = Path(__file__).resolve().parent
CONFIG_DIR = Path(GLib.get_user_config_dir()) / "meridian"
DATA_DIR = Path(GLib.get_user_data_dir()) / "meridian" / "webkit"
CACHE_DIR = Path(GLib.get_user_cache_dir()) / "meridian" / "webkit"
WINDOW_STATE = CONFIG_DIR / "window.ini"

RESIZE_EDGES = {
    "n": Gdk.WindowEdge.NORTH,
    "ne": Gdk.WindowEdge.NORTH_EAST,
    "e": Gdk.WindowEdge.EAST,
    "se": Gdk.WindowEdge.SOUTH_EAST,
    "s": Gdk.WindowEdge.SOUTH,
    "sw": Gdk.WindowEdge.SOUTH_WEST,
    "w": Gdk.WindowEdge.WEST,
    "nw": Gdk.WindowEdge.NORTH_WEST,
}

TEXT_TYPES = {
    "application/javascript",
    "application/json",
    "application/manifest+json",
    "image/svg+xml",
}


# --------------------------------------------------------------------------
# callendar:// file serving (legacy scheme kept for stored data)
# --------------------------------------------------------------------------


def _finish_error(request: WebKit2.URISchemeRequest, message: str) -> None:
    error = GLib.Error.new_literal(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND, message)
    request.finish_error(error)


def _serve_file(request: WebKit2.URISchemeRequest) -> None:
    """Answer callendar://app/<path> from the application directory."""

    try:
        relative = unquote(urlparse(request.get_uri()).path).lstrip("/") or START_PAGE
        target = (BASE_DIR / relative).resolve()

        if target != BASE_DIR and BASE_DIR not in target.parents:
            _finish_error(request, "Not found")
            return
        if not target.is_file():
            _finish_error(request, "Not found")
            return

        data = target.read_bytes()
    except (OSError, ValueError):
        _finish_error(request, "Could not read file")
        return

    mime, _ = mimetypes.guess_type(target.name)
    mime = mime or "application/octet-stream"
    if (mime.startswith("text/") or mime in TEXT_TYPES) and "charset" not in mime:
        mime += "; charset=utf-8"

    stream = Gio.MemoryInputStream.new_from_bytes(GLib.Bytes.new(data))
    request.finish(stream, len(data), mime)


def build_context() -> WebKit2.WebContext:
    """Create an isolated, persistent WebKit context for the app."""

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    manager = WebKit2.WebsiteDataManager(
        base_data_directory=str(DATA_DIR),
        base_cache_directory=str(CACHE_DIR),
    )
    context = WebKit2.WebContext.new_with_website_data_manager(manager)
    context.register_uri_scheme(SCHEME, _serve_file)

    security = context.get_security_manager()
    for register in (
        security.register_uri_scheme_as_secure,
        security.register_uri_scheme_as_cors_enabled,
    ):
        try:
            register(SCHEME)
        except Exception:
            # Deprecated in newer WebKitGTK releases; storage still works.
            pass

    return context


# --------------------------------------------------------------------------
# Window
# --------------------------------------------------------------------------


def _load_window_size() -> tuple[int, int]:
    keyfile = GLib.KeyFile()
    try:
        keyfile.load_from_file(str(WINDOW_STATE), GLib.KeyFileFlags.NONE)
        width = keyfile.get_integer("window", "width")
        height = keyfile.get_integer("window", "height")
        if 640 <= width <= 10000 and 480 <= height <= 10000:
            return width, height
    except GLib.Error:
        pass
    return DEFAULT_SIZE


def _was_maximized() -> bool:
    keyfile = GLib.KeyFile()
    try:
        keyfile.load_from_file(str(WINDOW_STATE), GLib.KeyFileFlags.NONE)
        return keyfile.get_boolean("window", "maximized")
    except GLib.Error:
        return False


class MeridianWindow(Gtk.ApplicationWindow):
    def __init__(self, app: Gtk.Application, context: WebKit2.WebContext):
        super().__init__(application=app, title=APP_NAME)
        self.set_icon_name("meridian")
        self.set_default_size(*_load_window_size())

        # The app draws its own title bar (the top bar in index.html), so the
        # native decorations are switched off. Dragging, double-click to
        # maximize and edge resizing come back through the script bridge below.
        self.set_decorated(False)

        self.webview = WebKit2.WebView.new_with_context(context)
        settings = self.webview.get_settings()
        settings.set_enable_html5_local_storage(True)
        settings.set_enable_html5_database(True)
        settings.set_javascript_can_access_clipboard(True)
        settings.set_enable_smooth_scrolling(True)
        settings.set_enable_developer_extras(
            bool(os.environ.get("MERIDIAN_DEV") or os.environ.get("CALLENDAR_DEV"))
        )

        self.webview.connect("decide-policy", self._on_decide_policy)
        self.webview.connect("load-changed", self._on_load_changed)
        self.add(self.webview)
        self.connect("destroy", self._save_window_state)
        self.connect("window-state-event", self._on_window_state_event)
        self._install_native_bridge()
        self._install_actions()

        self.webview.load_uri(f"{SCHEME}://{HOST}/{START_PAGE}")
        self.show_all()
        if _was_maximized():
            self.maximize()

    # -- native bridge -------------------------------------------------------

    def _install_native_bridge(self) -> None:
        """Expose print and the custom title bar actions to the web view."""

        manager = self.webview.get_user_content_manager()
        manager.register_script_message_handler("meridianNative")
        manager.connect("script-message-received::meridianNative", self._on_native_message)
        manager.add_script(
            WebKit2.UserScript.new(
                # Flag the page before first paint so the window controls are
                # laid out with the rest of the top bar instead of popping in.
                "try { document.documentElement.dataset.native = 'true'; } catch (e) {};"
                "window.print = function () {"
                "  window.webkit.messageHandlers.meridianNative.postMessage('print');"
                "};",
                WebKit2.UserContentInjectedFrames.TOP_FRAME,
                WebKit2.UserScriptInjectionTime.START,
                None,
                None,
            )
        )

    def _on_native_message(self, _manager, message) -> None:
        try:
            raw = message.get_js_value().to_string()
        except Exception:
            return

        command = raw.strip()
        payload: dict = {}
        try:
            decoded = json.loads(raw)
        except (TypeError, ValueError):
            decoded = None
        if isinstance(decoded, dict):
            command = str(decoded.get("command", ""))
            payload = decoded

        if command == "print":
            self._print()
        elif command == "window-minimize":
            self.iconify()
        elif command == "window-toggle-maximize":
            if self.is_maximized():
                self.unmaximize()
            else:
                self.maximize()
        elif command == "window-close":
            self.close()
        elif command == "window-state":
            self._push_window_state()
        elif command == "window-start-drag":
            self._start_move(payload)
        elif command == "window-start-resize":
            self._start_resize(payload)

    # -- custom title bar ----------------------------------------------------

    @staticmethod
    def _event_time() -> int:
        # Script messages arrive outside a GTK event, so the current event time
        # is often 0 (GDK_CURRENT_TIME). Wayland ignores the timestamp; X11
        # window managers generally accept CurrentTime as well.
        return Gtk.get_current_event_time() or Gdk.CURRENT_TIME

    @staticmethod
    def _pointer_args(payload: dict) -> tuple[int, int, int] | None:
        try:
            x = int(payload.get("x", 0))
            y = int(payload.get("y", 0))
            button = int(payload.get("button", 1)) or 1
        except (TypeError, ValueError):
            return None
        return x, y, button

    def _start_move(self, payload: dict) -> None:
        gdk_window = self.get_window()
        args = self._pointer_args(payload)
        if gdk_window is None or args is None:
            return
        x, y, button = args
        try:
            gdk_window.begin_move_drag(button, x, y, self._event_time())
        except Exception:
            pass

    def _start_resize(self, payload: dict) -> None:
        gdk_window = self.get_window()
        args = self._pointer_args(payload)
        edge = RESIZE_EDGES.get(str(payload.get("edge", "")))
        if gdk_window is None or args is None or edge is None:
            return
        x, y, button = args
        try:
            gdk_window.begin_resize_drag(edge, button, x, y, self._event_time())
        except Exception:
            pass

    def _push_window_state(self) -> None:
        """Tell the page whether to show the maximize or restore icon."""

        maximized = "true" if self.is_maximized() else "false"
        script = (
            "window.meridianWindowState && "
            f"window.meridianWindowState({{ maximized: {maximized} }});"
        )
        try:
            self.webview.evaluate_javascript(
                script, -1, None, None, None, None, None
            )
        except Exception:
            pass

    def _on_window_state_event(self, _widget, _event) -> bool:
        self._push_window_state()
        return False

    def _on_load_changed(self, _webview, load_event) -> None:
        if load_event == WebKit2.LoadEvent.FINISHED:
            self._push_window_state()

    def _install_actions(self) -> None:
        print_action = Gio.SimpleAction.new("print", None)
        print_action.connect("activate", lambda *_args: self._print())
        self.add_action(print_action)
        self.get_application().set_accels_for_action("win.print", ["<Primary>p"])

        close_action = Gio.SimpleAction.new("close", None)
        close_action.connect("activate", lambda *_args: self.close())
        self.add_action(close_action)
        self.get_application().set_accels_for_action("win.close", ["<Primary>w"])

    def _print(self) -> None:
        operation = WebKit2.PrintOperation.new(self.webview)
        operation.run_dialog(self)

    # -- links and downloads -------------------------------------------------

    def _on_decide_policy(self, _webview, decision, decision_type):
        if decision_type not in (
            WebKit2.PolicyDecisionType.NAVIGATION_ACTION,
            WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION,
        ):
            return False

        navigation = decision.get_navigation_action()
        request = navigation.get_request()
        uri = request.get_uri() if request else ""
        if not uri:
            return False

        if decision_type == WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION:
            self._open_link(uri)
            decision.ignore()
            return True

        if uri.startswith(f"{SCHEME}://"):
            return False

        decision.ignore()
        self._open_link(uri)
        return True

    def _open_link(self, uri: str) -> None:
        if uri.startswith("tel:"):
            self._show_phone_number(uri)
            return

        try:
            Gio.AppInfo.launch_default_for_uri(uri, None)
        except GLib.Error as error:
            dialog = Gtk.MessageDialog(
                transient_for=self,
                modal=True,
                message_type=Gtk.MessageType.WARNING,
                buttons=Gtk.ButtonsType.OK,
                text="Could not open this link",
            )
            dialog.format_secondary_text(error.message)
            dialog.run()
            dialog.destroy()

    def _show_phone_number(self, uri: str) -> None:
        """No telephony backend on most desktops, so offer the number to copy."""

        number = uri.split(":", 1)[-1].strip()
        dialog = Gtk.MessageDialog(
            transient_for=self,
            modal=True,
            message_type=Gtk.MessageType.INFO,
            buttons=Gtk.ButtonsType.NONE,
            text=f"Call {number}",
        )
        dialog.format_secondary_text(
            "Copy the number and dial it from your phone, or hand it to a calling app."
        )
        dialog.add_button("Copy number", 1)
        dialog.add_button("Open with…", 2)
        dialog.add_button("Close", Gtk.ResponseType.CLOSE)
        response = dialog.run()

        if response == 1:
            clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
            clipboard.set_text(number, -1)
            clipboard.store()
        elif response == 2:
            try:
                Gio.AppInfo.launch_default_for_uri(uri, None)
            except GLib.Error:
                dialog.hide()
                fallback = Gtk.MessageDialog(
                    transient_for=self,
                    modal=True,
                    message_type=Gtk.MessageType.WARNING,
                    buttons=Gtk.ButtonsType.OK,
                    text="No calling app is configured",
                )
                fallback.format_secondary_text(
                    f"Copy {number} and dial it from your phone instead."
                )
                fallback.run()
                fallback.destroy()

        dialog.destroy()

    # -- window state --------------------------------------------------------

    def _save_window_state(self, *_args) -> None:
        try:
            maximized = self.is_maximized()
            keyfile = GLib.KeyFile()
            # While maximized, get_size() reports the workspace, not the size
            # the user chose. Keep the previous geometry so restoring the
            # window lands somewhere sensible.
            if not maximized:
                width, height = self.get_size()
                # Ignore geometry reported while the window is being torn
                # down; keeping the previous state beats storing 1-pixel
                # dimensions.
                if not (480 <= width <= 10000 and 360 <= height <= 10000):
                    return
                keyfile.set_integer("window", "width", width)
                keyfile.set_integer("window", "height", height)
            else:
                keyfile.load_from_file(str(WINDOW_STATE), GLib.KeyFileFlags.NONE)
            CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            keyfile.set_boolean("window", "maximized", maximized)
            keyfile.save_to_file(str(WINDOW_STATE))
        except (GLib.Error, OSError):
            pass


# --------------------------------------------------------------------------
# Application
# --------------------------------------------------------------------------


class MeridianApp(Gtk.Application):
    def __init__(self) -> None:
        super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.FLAGS_NONE)
        self.context: WebKit2.WebContext | None = None
        self.window: MeridianWindow | None = None

    def do_startup(self) -> None:
        Gtk.Application.do_startup(self)
        self.context = build_context()
        self.context.connect("download-started", self._on_download_started)

    def do_activate(self) -> None:
        if self.window is None:
            assert self.context is not None
            self.window = MeridianWindow(self, self.context)
            self.window.connect("destroy", self._forget_window)
        self.window.present()

    def _forget_window(self, _window) -> None:
        self.window = None

    def _on_download_started(self, _context, download: WebKit2.Download) -> None:
        suggested = download.get_suggested_filename() or "meridian-download"
        folder = (
            GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOADS)
            or str(Path.home())
        )

        chooser = Gtk.FileChooserDialog(
            title="Save file",
            transient_for=self.window,
            action=Gtk.FileChooserAction.SAVE,
            buttons=(
                "Cancel",
                Gtk.ResponseType.CANCEL,
                "Save",
                Gtk.ResponseType.ACCEPT,
            ),
        )
        chooser.set_do_overwrite_confirmation(True)
        chooser.set_current_folder(folder)
        chooser.set_current_name(suggested)
        response = chooser.run()
        destination = chooser.get_filename()
        chooser.destroy()

        if response == Gtk.ResponseType.ACCEPT and destination:
            download.set_allow_overwrite(True)
            download.set_destination(Gio.File.new_for_path(destination).get_uri())
        else:
            download.cancel()

        download.connect(
            "failed",
            lambda _download, error: print(
                f"Meridian: download failed: {error.message}", file=sys.stderr
            ),
        )


def main() -> int:
    GLib.set_prgname("meridian")
    GLib.set_application_name(APP_NAME)
    Gtk.Window.set_default_icon_name("meridian")
    return MeridianApp().run(sys.argv)


if __name__ == "__main__":
    raise SystemExit(main())
