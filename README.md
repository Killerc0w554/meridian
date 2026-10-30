# Project M

A 24-hour appointment calendar and hiring pipeline that keeps the phone number
on every appointment. Click a time slot, add the caller, and call them straight
from the schedule — or move them through your hiring stages on the board.

No build step, no account, and no cloud. Your calendar stays on this machine.

## Run it

Project M is a native desktop app: a GTK window with an embedded WebKit view.
It needs no browser and no local web server.

Launch it from your app menu (search for **Project M**) or from a terminal:

```bash
~/Work/project-m/project-m
```

On this machine the launcher is installed at
`~/.local/share/applications/project-m.desktop` and the icon at
`~/.local/share/icons/hicolor/scalable/apps/project-m.svg`.

It uses the system `gtk3`, `webkit2gtk-4.1`, and `python-gobject` packages.

### Optional: open in a browser

The interface is also still a plain static site:

```bash
cd project-m
python3 -m http.server 8765
```

Then open <http://localhost:8765>. The browser copy keeps its data separately
from the desktop app.

## What it does

- **A native window** — launches from the app menu, remembers its size, and
  keeps the calendar in its own profile instead of a browser tab. It also draws
  its own title bar: minimize, maximize/restore, and close sit in the calendar's
  top bar, which doubles as a drag handle (double-click to maximize).
- **Click to call** — appointment numbers are `tel:` links. On a desktop with no
  dialer, clicking one offers to copy the number or hand it to a calling app.
- **Native dialogs** — printing (`Ctrl+P`) and exporting use the system print
  and save dialogs.
- **Full 24-hour day** — every day shows midnight to midnight, scrolling to the
  current time on load. Week starts Monday.
- **Click or drag to schedule** — click any empty slot for a 30-minute
  appointment, or drag down the column to set the exact length. Times snap to
  15 minutes.
- **A phone number per appointment** — numbers are `tel:` links in the calendar
  block, in the "Next up" bar, and in the editor, so one click starts a call on
  a phone or calling-enabled device (or copies the number on a desktop with no
  dialer).
- **Hiring pipeline** — every appointment sits in one of six stages: **Applied,
  Screen, Interview, Offer, Hired, Rejected**. Pick the stage in the editor, or
  drag a card between columns on the pipeline board. Longer appointments show a
  labelled stage badge, shorter ones a colored dot, and month chips always carry
  a dot. The stage appears in the "Next up" bar, is included in exported `.ics`
  files, and can be found with search. Appointments saved before the pipeline
  existed fall into **Applied** and are written back as such when you save them.
- **Renameable stages** — click a column header on the board to rename it
  (`Enter` or blur saves, `Esc` cancels, an empty name reverts to the default,
  24 characters max). Renames are labels only: the underlying stage keys never
  change, so your appointments, exports, and searches keep working. Restore the
  originals with **⋯ → Reset stage names**, which appears once you have
  customized one.
- **Day, week, month, and pipeline views** — opens in month view every time;
  tap a date header to jump into that day. Week view scrolls sideways on small
  screens with the time column pinned. Month view shows the whole month in one
  grid; click a day to open it, or a `+N more` link when a day is packed. The
  pipeline board shows one column per stage with a live count, and search
  filters the board too.
- **Overlap-aware layout** — conflicting appointments sit side by side, and the
  editor warns you before you double-book. Use **Save & new** to book several
  callers into the same time slot without re-entering the date and time.
- **Next up** — the soonest appointment is always one click away, with a Call
  button.
- **Search** — filter by name, phone number, notes, or stage; matches are
  highlighted and everything else dims.
- **Notes** — keep an agenda or context on the appointment.
- **Export** — download one appointment or the whole schedule as an `.ics`
  file for Google Calendar, Apple Calendar, Outlook, etc. Phone numbers go into
  the event description and the hiring stage into a `Stage:` property.
- **Backup and restore** — export/import the whole calendar as JSON.
- **24-hour clock toggle** — defaults to your locale; switch anytime from the
  ⋯ menu.
- **Print** — prints a clean paper schedule.
- **Dark or light** — follows your system theme by default; switch **Light mode**
  on or off in the ⋯ menu to pin a theme. The dark theme is layered graphite
  rather than flat black, and the light theme is paper-white with slate text.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `N` | New appointment |
| `T` | Jump to today |
| `D` / `W` / `M` | Day / week / month view |
| `P` | Pipeline board |
| `←` / `→` | Previous / next day, week, or month |
| `/` | Open search |
| `Enter` / `Space` | Open the focused appointment |
| `Esc` | Close the editor or menu |
| `Ctrl+P` | Print the current view |
| `Ctrl+W` | Close the window |

## Where the data lives

The desktop app stores its calendar in its own WebKit profile (kept under the
original `meridian` folder so existing appointments survive the rebrand):

```
~/.local/share/meridian/webkit/
```

Inside that profile it uses storage keys carried over from the app's original
name, so existing appointments keep loading:

- `callendar.events.v1`
- `callendar.settings.v1` (clock format, theme, and custom stage names)

The window size is remembered in `~/.config/meridian/window.ini`.

If you open the app in a browser instead, those keys go in that browser's
`localStorage`, so the two copies do not share data.

Nothing is sent anywhere. Clearing the app's profile will delete the calendar,
so use **⋯ → Export backup (.json)** before wiping it or moving to another
computer. Import merges appointments by id, assigning new ids to duplicates.

The first run adds three sample appointments so the week isn't empty. Delete
them like any other appointment.

## Files

```
project-m launcher (starts the native app)
project_m_app.py GTK window, callendar:// asset serving, native dialogs
project-m.svg application icon and logo source
project-m-wordmark.svg custom wordmark used in the app header
project-m-wordmark-preview.png header and light/dark wordmark preview
project-m-logo.png raster preview of the logo
index.html                      markup and inline icons
styles.css                      layout, themes, responsive and print styles
app.js                          calendar rendering, scheduling, storage, import/export
```

The header wordmark is set in JetBrains Mono with wide tracking, in the style
of the 04 Technical direction. The source lives in `project-m-wordmark.svg`
and is inlined into `index.html`; its gradient follows the light and dark
palettes in `styles.css`.

To remove the desktop integration, delete
`~/.local/share/applications/project-m.desktop` and
`~/.local/share/icons/hicolor/scalable/apps/project-m.svg`. The calendar data
stays in `~/.local/share/meridian/` until you delete that folder too.
