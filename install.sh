#!/usr/bin/env bash
# Install Project M for the current user: app launcher + icon in the
# standard XDG locations. No root needed.
set -euo pipefail

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

data="${XDG_DATA_HOME:-$HOME/.local/share}"
apps="$data/applications"
icons="$data/icons/hicolor/scalable/apps"

if [ ! -x "$here/project-m" ]; then
  chmod +x "$here/project-m"
fi

install -d "$apps" "$icons"
install -m 644 "$here/project-m.svg" "$icons/project-m.svg"

# Point the launcher at wherever this checkout lives.
sed "s|@EXEC@|$here/project-m|g" > "$apps/project-m.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Version=1.5
Name=Project M
GenericName=Appointment Calendar
Comment=24-hour appointment calendar and hiring pipeline with phone numbers
Exec=@EXEC@
TryExec=@EXEC@
Icon=project-m
Terminal=false
Categories=Office;Calendar;
Keywords=calendar;appointment;schedule;phone;call;hiring;pipeline;
StartupNotify=true
StartupWMClass=project-m
DESKTOP

chmod 644 "$apps/project-m.desktop"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$apps" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -t "$data/icons/hicolor" >/dev/null 2>&1 || true
fi

printf 'Installed:\n  %s\n  %s\n\nLaunch "Project M" from your app menu, or run:\n  %s\n' \
  "$apps/project-m.desktop" "$icons/project-m.svg" "$here/project-m"
