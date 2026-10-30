/* Project M — 24-hour appointment calendar
   No build step, no dependencies. Data lives in localStorage. */
(() => {
  'use strict';

  // Legacy key names, kept so appointments saved under the old app name load.
  const STORE_KEY = 'callendar.events.v1';
  const SETTINGS_KEY = 'callendar.settings.v1';
  const SNAP = 15;
  const DAY_MIN = 1440;

  const COLORS = [
    '96,165,250',   // blue
    '45,212,191',   // teal
    '167,139,250',  // violet
    '251,191,36',   // amber
    '251,113,133',  // rose
    '34,211,238',   // cyan
    '163,230,53',   // lime
    '251,146,60',   // orange
  ];

  const PHONE_ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>';

  const STATUS_LABELS = {
    hiring: 'Hiring',
    'not-hiring': 'Not hiring',
  };

  function statusKey(value) {
    return value === 'hiring' || value === 'not-hiring' ? value : '';
  }

  function statusLabel(value) {
    const key = statusKey(value);
    return key ? STATUS_LABELS[key] : '';
  }

  function searchHaystack(ev) {
    return `${ev.title} ${ev.phone} ${ev.notes} ${statusLabel(ev.status)}`.toLowerCase();
  }

  const el = {
    grid: document.getElementById('calGrid'),
    scroll: document.getElementById('calScroll'),
    range: document.getElementById('rangeLabel'),
    prev: document.getElementById('prevBtn'),
    next: document.getElementById('nextBtn'),
    today: document.getElementById('todayBtn'),
    viewButtons: Array.from(document.querySelectorAll('[data-view]')),
    dock: document.getElementById('quickDock'),
    dockBubble: document.getElementById('quickDockBubble'),
    dockAdd: document.getElementById('quickDockAdd'),
    dockSearch: document.getElementById('dockSearch'),
    nextUp: document.getElementById('nextUp'),
    nextUpMain: document.getElementById('nextUpMain'),
    nextUpWhen: document.getElementById('nextUpWhen'),
    nextUpTitle: document.getElementById('nextUpTitle'),
    nextUpCall: document.getElementById('nextUpCall'),
    nextUpStatus: document.getElementById('nextUpStatus'),
    menuWrap: document.querySelector('.menu-wrap'),
    menuBtn: document.getElementById('menuBtn'),
    menu: document.getElementById('menu'),
    clockItem: document.getElementById('clockItem'),
    themeItem: document.getElementById('themeItem'),
    dialog: document.getElementById('eventDialog'),
    form: document.getElementById('eventForm'),
    dialogTitle: document.getElementById('dialogTitle'),
    titleInput: document.getElementById('evTitle'),
    phoneInput: document.getElementById('evPhone'),
    dateInput: document.getElementById('evDate'),
    startInput: document.getElementById('evStart'),
    endInput: document.getElementById('evEnd'),
    notesInput: document.getElementById('evNotes'),
    statusToggle: document.getElementById('statusToggle'),
    statusButtons: Array.from(document.querySelectorAll('#statusToggle [data-status]')),
    durationNote: document.getElementById('durationNote'),
    conflictNote: document.getElementById('conflictNote'),
    conflictText: document.getElementById('conflictText'),
    deleteBtn: document.getElementById('deleteBtn'),
    icsBtn: document.getElementById('icsBtn'),
    addAnotherBtn: document.getElementById('addAnotherBtn'),
    cancelBtn: document.getElementById('cancelBtn'),
    closeBtn: document.getElementById('closeDialogBtn'),
    saveBtn: document.getElementById('saveBtn'),
    modalCall: document.getElementById('modalCall'),
    dialogBody: document.querySelector('.dialog-body'),
    fileInput: document.getElementById('importInput'),
  };

  const state = {
    view: 'month',
    cursor: startOfDay(new Date()),
    events: [],
    settings: { clock24: false, theme: null },
    query: '',
    editingId: null,
    nextUpId: null,
    renderedDay: isoDate(new Date()),
  };

  let drag = null;

  const lightQuery = window.matchMedia('(prefers-color-scheme: light)');

  /* ------------------------------------------------------------------ *
   * Dates and formatting
   * ------------------------------------------------------------------ */

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  function isoDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parseISODate(value) {
    const [y, m, d] = String(value).split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function startOfWeek(date) {
    const day = startOfDay(date);
    return addDays(day, -((day.getDay() + 6) % 7)); // Monday
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function addMonths(date, months) {
    const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(date.getDate(), lastDay));
    return target;
  }

  function monthGridDays(date) {
    const first = startOfMonth(date);
    const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const start = startOfWeek(first);
    const end = addDays(startOfWeek(last), 6);
    const days = [];
    for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
    return days;
  }

  function minutesOfDay(date) {
    return date.getHours() * 60 + date.getMinutes();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function defaultClock24() {
    try {
      const cycle = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
      return cycle === 'h23' || cycle === 'h24';
    } catch (err) {
      return false;
    }
  }

  function formatTime(minutes, options = {}) {
    const value = clamp(Math.round(minutes), 0, DAY_MIN);
    if (value >= DAY_MIN) return state.settings.clock24 ? '24:00' : '12 AM';
    const h = Math.floor(value / 60);
    const m = value % 60;
    if (state.settings.clock24) return `${pad(h)}:${pad(m)}`;
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    if (options.compact && m === 0) return `${hour} ${suffix}`;
    return `${hour}:${pad(m)} ${suffix}`;
  }

  function formatDuration(minutes) {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (!m) return `${h} hr${h === 1 ? '' : 's'}`;
    return `${h}h ${m}m`;
  }

  function minutesToInput(minutes) {
    const value = clamp(Math.round(minutes), 0, DAY_MIN);
    return `${pad(Math.floor(value / 60) % 24)}:${pad(value % 60)}`;
  }

  function inputToMinutes(value) {
    if (!value) return null;
    const parts = String(value).split(':');
    if (parts.length < 2) return null;
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  }

  function formatRange(days) {
    if (state.view === 'month') {
      return new Intl.DateTimeFormat(undefined, {
        month: 'long',
        year: 'numeric',
      }).format(state.cursor);
    }
    if (state.view === 'day') {
      return new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }).format(days[0]);
    }
    const first = days[0];
    const last = days[days.length - 1];
    const firstFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    const lastFmt = new Intl.DateTimeFormat(undefined, {
      month: first.getMonth() === last.getMonth() ? undefined : 'short',
      day: 'numeric',
    });
    if (first.getFullYear() !== last.getFullYear()) {
      const withYear = { month: 'short', day: 'numeric', year: 'numeric' };
      return `${new Intl.DateTimeFormat(undefined, withYear).format(first)} – ${new Intl.DateTimeFormat(undefined, withYear).format(last)}`;
    }
    return `${firstFmt.format(first)} – ${lastFmt.format(last)}, ${first.getFullYear()}`;
  }

  function hasDialable(phone) {
    return (String(phone).match(/\d/g) || []).length >= 3;
  }

  function telHref(phone) {
    return `tel:${String(phone).replace(/[^\d+]/g, '')}`;
  }

  // Format North American numbers as 555-123-4567. Longer numbers keep their
  // country code (and a leading + if one was typed) so pasted international
  // numbers are not mangled.
  function formatPhoneNumber(value) {
    const raw = String(value);
    const digits = raw.replace(/\D/g, '');
    const plus = raw.trimStart().startsWith('+') ? '+' : '';
    if (!digits) return plus;

    if (digits.length > 10) {
      const country = digits.slice(0, digits.length - 10);
      const local = digits.slice(-10);
      const joiner = plus ? ' ' : '-';
      return `${plus}${country}${joiner}${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
    }

    const groups = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 10)].filter(Boolean);
    return `${plus}${groups.join('-')}`;
  }

  // Writes the formatted number back while keeping the caret in the same
  // place relative to the digits. When a separator was just inserted ahead of
  // the caret, step over it so the next digit is typed after the dash.
  function formatPhoneInput(input) {
    const value = input.value;
    const caret = input.selectionStart == null ? value.length : input.selectionStart;
    const digitsBeforeCaret = (value.slice(0, caret).match(/\d/g) || []).length;
    const formatted = formatPhoneNumber(value);
    if (formatted === value) return;

    input.value = formatted;
    let position = 0;
    let seen = 0;
    while (position < formatted.length && seen < digitsBeforeCaret) {
      if (/\d/.test(formatted[position])) seen += 1;
      position += 1;
    }
    while (position < formatted.length && !/\d/.test(formatted[position])) position += 1;
    input.setSelectionRange(position, position);
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function colorFor(ev) {
    if (Number.isInteger(ev.color)) return COLORS[((ev.color % COLORS.length) + COLORS.length) % COLORS.length];
    let hash = 0;
    for (let i = 0; i < ev.id.length; i += 1) hash = (hash * 31 + ev.id.charCodeAt(i)) >>> 0;
    return COLORS[hash % COLORS.length];
  }

  /* ------------------------------------------------------------------ *
   * Storage
   * ------------------------------------------------------------------ */

  function loadSettings() {
    state.settings.clock24 = defaultClock24();
    state.settings.theme = null;
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed.clock24 === 'boolean') state.settings.clock24 = parsed.clock24;
      if (parsed.theme === 'light' || parsed.theme === 'dark') state.settings.theme = parsed.theme;
    } catch (err) {
      /* storage unavailable — keep defaults */
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch (err) {
      /* ignore */
    }
  }

  function normalizeEvent(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw.date || ''))) return null;
    let start = Number(raw.start);
    let end = Number(raw.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    start = clamp(Math.round(start), 0, 1439);
    end = Math.round(end);
    if (end === 0 && start > 0) end = DAY_MIN;
    end = clamp(end, 15, DAY_MIN);
    if (end <= start) end = Math.min(DAY_MIN, start + 30);
    const ev = {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
      date: String(raw.date),
      start,
      end,
      title: String(raw.title || 'Appointment').slice(0, 120).trim() || 'Appointment',
      phone: String(raw.phone || '').slice(0, 60).trim(),
      notes: String(raw.notes || '').slice(0, 2000),
      status: statusKey(raw.status),
    };
    if (Number.isInteger(raw.color)) ev.color = raw.color;
    return ev;
  }

  function loadEvents() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw === null) {
        state.events = seedEvents();
        saveEvents();
      } else {
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : [];
        state.events = list.map(normalizeEvent).filter(Boolean);
      }
    } catch (err) {
      state.events = [];
    }
    sortEvents();
  }

  function saveEvents() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state.events));
    } catch (err) {
      console.error('Project M: could not save appointments', err);
    }
  }

  function sortEvents() {
    state.events.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.start !== b.start) return a.start - b.start;
      return a.end - b.end;
    });
  }

  function seedEvents() {
    const now = new Date();
    let firstDay = startOfDay(now);
    let firstStart = Math.ceil((minutesOfDay(now) + 90) / 30) * 30;
    if (firstStart > 21 * 60) {
      firstDay = addDays(now, 1);
      firstStart = 10 * 60;
    }
    const tomorrow = addDays(now, 1);
    const dayAfter = addDays(now, 2);
    const sample = [
      {
        date: isoDate(firstDay),
        start: firstStart,
        end: Math.min(firstStart + 45, DAY_MIN),
        title: 'Intro call — Dana Whitfield',
        phone: '+1 415 555 0132',
        notes: 'Sample appointment. Ask about timeline, team size, and budget.',
        color: 0,
      },
      {
        date: isoDate(tomorrow),
        start: 14 * 60 + 30,
        end: 15 * 60,
        title: 'Follow-up — Marcus Lee',
        phone: '+1 212 555 0188',
        notes: 'Sample appointment. Send the proposal beforehand.',
        color: 2,
      },
      {
        date: isoDate(dayAfter),
        start: 9 * 60 + 15,
        end: 10 * 60,
        title: 'Product walkthrough — Priya Raman',
        phone: '+1 650 555 0117',
        notes: 'Sample appointment. Screen share the scheduling flow.',
        color: 3,
      },
    ];
    return sample.map((entry) => normalizeEvent({ ...entry, id: uid() })).filter(Boolean);
  }

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */

  function visibleDays() {
    if (state.view === 'month') return monthGridDays(state.cursor);
    if (state.view === 'day') return [startOfDay(state.cursor)];
    const start = startOfWeek(state.cursor);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }

  function eventsOn(iso) {
    return state.events
      .filter((ev) => ev.date === iso)
      .sort((a, b) => a.start - b.start || b.end - a.end);
  }

  function layoutEvents(list) {
    const result = new Map();
    if (!list.length) return result;
    const sorted = list.slice().sort((a, b) => a.start - b.start || a.end - b.end);
    let group = [];
    let groupEnd = -1;

    const flush = () => {
      if (!group.length) return;
      const columns = [];
      for (const ev of group) {
        let placed = false;
        for (let i = 0; i < columns.length; i += 1) {
          if (columns[i] <= ev.start) {
            columns[i] = ev.end;
            result.set(ev.id, { col: i, cols: 1 });
            placed = true;
            break;
          }
        }
        if (!placed) {
          columns.push(ev.end);
          result.set(ev.id, { col: columns.length - 1, cols: 1 });
        }
      }
      for (const ev of group) {
        const entry = result.get(ev.id);
        if (entry) entry.cols = columns.length;
      }
      group = [];
      groupEnd = -1;
    };

    for (const ev of sorted) {
      if (group.length && ev.start >= groupEnd) flush();
      group.push(ev);
      groupEnd = Math.max(groupEnd, ev.end);
    }
    flush();
    return result;
  }

  function renderEvent(ev, layout) {
    const duration = ev.end - ev.start;
    const status = statusKey(ev.status);
    const node = document.createElement('div');
    node.className = 'event';
    if (duration <= 30) node.classList.add('compact');
    else if (duration < 60) node.classList.add('short');
    node.dataset.id = ev.id;
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.setAttribute(
      'aria-label',
      `${ev.title}, ${formatTime(ev.start)} to ${formatTime(ev.end)}${status ? `, ${STATUS_LABELS[status]}` : ''}${ev.phone ? `, ${ev.phone}` : ''}`
    );
    node.style.setProperty('--top', `${(ev.start / DAY_MIN) * 100}%`);
    node.style.setProperty('--height', `${(Math.max(duration, SNAP) / DAY_MIN) * 100}%`);

    const col = layout ? layout.col : 0;
    const cols = layout ? layout.cols : 1;
    node.style.setProperty('--left', `${(col / cols) * 100}%`);
    node.style.setProperty('--width', `${100 / cols}%`);
    node.style.setProperty('--rgb', colorFor(ev));

    const time = document.createElement('span');
    time.className = 'event-time';
    time.textContent = duration < 60
      ? formatTime(ev.start, { compact: true })
      : `${formatTime(ev.start)} – ${formatTime(ev.end)}`;

    const title = document.createElement('span');
    title.className = 'event-title';
    title.textContent = ev.title;
    title.title = ev.title;

    node.append(time, title);

    if (status) {
      node.classList.add('has-status');
      const badge = document.createElement('span');
      badge.className = 'event-status';
      badge.dataset.status = status;
      badge.title = STATUS_LABELS[status];
      const dot = document.createElement('span');
      dot.className = 'status-dot';
      dot.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.className = 'status-text';
      text.textContent = STATUS_LABELS[status];
      badge.append(dot, text);
      node.append(badge);
    }

    if (ev.phone && hasDialable(ev.phone)) {
      const phone = document.createElement('a');
      phone.className = 'event-phone';
      phone.href = telHref(ev.phone);
      phone.title = `Call ${ev.phone}`;
      phone.innerHTML = PHONE_ICON;
      phone.append(document.createTextNode(ev.phone));
      phone.addEventListener('click', (event) => event.stopPropagation());
      node.append(phone);
    } else if (!ev.phone && ev.notes && duration >= 45) {
      const note = document.createElement('span');
      note.className = 'event-note';
      note.textContent = ev.notes.replace(/\s+/g, ' ').trim();
      node.append(note);
    }

    return node;
  }

  function renderMonthEvent(ev) {
    const status = statusKey(ev.status);
    const chip = document.createElement('div');
    chip.className = 'md-event';
    chip.dataset.id = ev.id;
    chip.tabIndex = 0;
    chip.setAttribute('role', 'button');
    chip.style.setProperty('--rgb', colorFor(ev));
    chip.title = `${formatTime(ev.start)} – ${formatTime(ev.end)} · ${ev.title}${status ? ` · ${STATUS_LABELS[status]}` : ''}${ev.phone ? ` · ${ev.phone}` : ''}`;
    chip.setAttribute(
      'aria-label',
      `${formatTime(ev.start)} ${ev.title}${status ? `, ${STATUS_LABELS[status]}` : ''}${ev.phone ? `, ${ev.phone}` : ''}. Edit appointment.`
    );

    const time = document.createElement('span');
    time.className = 'md-time';
    time.textContent = formatTime(ev.start, { compact: true });

    const title = document.createElement('span');
    title.className = 'md-title';
    if (status) {
      const dot = document.createElement('span');
      dot.className = 'md-status';
      dot.dataset.status = status;
      dot.title = STATUS_LABELS[status];
      title.append(dot);
    }
    title.append(document.createTextNode(ev.title));
    title.title = `${ev.title}${status ? ` — ${STATUS_LABELS[status]}` : ''}`;

    chip.append(time, title);

    if (ev.phone && hasDialable(ev.phone)) {
      const phone = document.createElement('a');
      phone.className = 'md-phone';
      phone.href = telHref(ev.phone);
      phone.title = `Call ${ev.phone}`;
      phone.setAttribute('aria-label', `Call ${ev.phone}`);
      phone.innerHTML = PHONE_ICON;
      phone.addEventListener('click', (event) => event.stopPropagation());
      chip.append(phone);
    }

    return chip;
  }

  function renderMonth(options = {}) {
    const preserveScroll = options.preserveScroll !== false;
    const previousScroll = preserveScroll ? el.scroll.scrollTop : 0;
    const days = monthGridDays(state.cursor);
    const today = isoDate(new Date());
    const month = state.cursor.getMonth();
    const year = state.cursor.getFullYear();
    const query = state.query.trim().toLowerCase();
    const maxChips = window.matchMedia('(max-width: 720px)').matches ? 2 : 3;

    el.range.textContent = formatRange(days);
    el.range.title = el.range.textContent;
    el.grid.classList.add('is-month');
    el.grid.style.setProperty('--cols', '7');
    el.grid.setAttribute('aria-label', 'Month calendar');

    const printTitle = document.createElement('h2');
    printTitle.className = 'month-print-title';
    printTitle.textContent = el.range.textContent;

    const head = document.createElement('div');
    head.className = 'month-headrow';
    head.setAttribute('aria-hidden', 'true');
    const first = startOfWeek(startOfMonth(state.cursor));
    for (let index = 0; index < 7; index += 1) {
      const cell = document.createElement('div');
      cell.className = 'month-dow';
      cell.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
        .format(addDays(first, index))
        .toUpperCase();
      head.append(cell);
    }

    const grid = document.createElement('div');
    grid.className = 'month-grid';
    grid.setAttribute('role', 'grid');

    for (const day of days) {
      const iso = isoDate(day);
      const dayEvents = eventsOn(iso);
      const query = state.query.trim().toLowerCase();
      const shown = query ? dayEvents.filter((ev) => searchHaystack(ev).includes(query)) : dayEvents;

      const cell = document.createElement('div');
      cell.className = 'month-day';
      cell.dataset.date = iso;
      cell.tabIndex = 0;
      cell.setAttribute('role', 'gridcell');
      if (day.getFullYear() !== year || day.getMonth() !== month) cell.classList.add('is-outside');
      if (iso === today) cell.classList.add('is-today');

      const readable = new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }).format(day);
      const count = dayEvents.length;
      cell.setAttribute(
        'aria-label',
        `${readable}${count ? `, ${count} appointment${count === 1 ? '' : 's'}` : ', no appointments'}. Activate to open the day.`
      );

      const top = document.createElement('div');
      top.className = 'md-top';
      const number = document.createElement('span');
      number.className = 'md-num';
      number.textContent = String(day.getDate());
      top.append(number);

      if (query) {
        const tally = document.createElement('span');
        tally.className = 'md-count';
        tally.textContent = String(shown.length);
        tally.title = `${shown.length} matching appointment${shown.length === 1 ? '' : 's'}`;
        top.append(tally);
      }
      cell.append(top);

      if (shown.length) {
        const list = document.createElement('div');
        list.className = 'md-events';
        for (const ev of shown.slice(0, maxChips)) list.append(renderMonthEvent(ev));
        if (shown.length > maxChips) {
          const more = document.createElement('button');
          more.type = 'button';
          more.className = 'md-more';
          more.textContent = `+${shown.length - maxChips} more`;
          more.setAttribute(
            'aria-label',
            `Show ${shown.length - maxChips} more appointment${shown.length - maxChips === 1 ? '' : 's'} on ${readable}`
          );
          list.append(more);
        }
        cell.append(list);
      }

      grid.append(cell);
    }

    const frag = document.createDocumentFragment();
    frag.append(printTitle, head, grid);
    el.grid.replaceChildren(frag);
    if (preserveScroll) el.scroll.scrollTop = previousScroll;

    state.renderedDay = today;
    applySearch();
    updateNextUp();
  }

  function render(options = {}) {
    if (state.view === 'month') {
      renderMonth(options);
      return;
    }
    el.grid.classList.remove('is-month');
    const preserveScroll = options.preserveScroll !== false;
    const previousScroll = preserveScroll ? el.scroll.scrollTop : 0;
    const days = visibleDays();
    const today = isoDate(new Date());
    const counts = new Map();
    for (const ev of state.events) counts.set(ev.date, (counts.get(ev.date) || 0) + 1);

    el.range.textContent = formatRange(days);
    el.range.title = el.range.textContent;
    el.grid.style.setProperty('--cols', String(days.length));
    el.grid.setAttribute('aria-label', state.view === 'day' ? 'Day calendar' : 'Week calendar');

    const frag = document.createDocumentFragment();
    const headRow = document.createElement('div');
    headRow.className = 'cal-headrow';

    const corner = document.createElement('div');
    corner.className = 'corner';
    corner.setAttribute('aria-hidden', 'true');
    headRow.append(corner);

    for (const day of days) {
      const iso = isoDate(day);
      const count = counts.get(iso) || 0;
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'day-head';
      head.dataset.date = iso;
      if (iso === today) {
        head.classList.add('is-today');
        head.setAttribute('aria-current', 'date');
      }
      const readable = new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }).format(day);
      head.setAttribute(
        'aria-label',
        `${readable}${count ? `, ${count} appointment${count === 1 ? '' : 's'}` : ', no appointments'}`
      );

      const dow = document.createElement('span');
      dow.className = 'dh-dow';
      dow.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(day).toUpperCase();
      const number = document.createElement('span');
      number.className = 'dh-day';
      number.textContent = String(day.getDate());
      head.append(dow, number);

      if (count) {
        const badge = document.createElement('span');
        badge.className = 'dh-count';
        badge.textContent = String(count);
        badge.setAttribute('aria-hidden', 'true');
        head.append(badge);
      }
      headRow.append(head);
    }
    frag.append(headRow);

    const bodyRow = document.createElement('div');
    bodyRow.className = 'cal-bodyrow';

    const gutter = document.createElement('div');
    gutter.className = 'time-gutter';
    gutter.setAttribute('aria-hidden', 'true');
    for (let hour = 0; hour < 24; hour += 1) {
      const slot = document.createElement('div');
      slot.className = 'hour-slot';
      const label = document.createElement('span');
      label.textContent = state.settings.clock24
        ? `${pad(hour)}:00`
        : formatTime(hour * 60, { compact: true });
      slot.append(label);
      gutter.append(slot);
    }
    bodyRow.append(gutter);

    const now = new Date();
    const nowMinutes = minutesOfDay(now);

    for (const day of days) {
      const iso = isoDate(day);
      const column = document.createElement('div');
      column.className = 'day-col';
      column.dataset.date = iso;
      column.setAttribute('role', 'group');
      column.setAttribute(
        'aria-label',
        new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(day)
      );
      const isToday = iso === today;
      if (isToday) column.classList.add('is-today');

      const dayEvents = eventsOn(iso);
      const layouts = layoutEvents(dayEvents);
      for (const ev of dayEvents) column.append(renderEvent(ev, layouts.get(ev.id)));

      if (isToday) {
        const line = document.createElement('div');
        line.className = 'now-line';
        line.style.setProperty('--now', `${(nowMinutes / DAY_MIN) * 100}%`);
        line.setAttribute('aria-hidden', 'true');
        column.append(line);
      }

      bodyRow.append(column);
    }

    frag.append(bodyRow);
    el.grid.replaceChildren(frag);
    if (preserveScroll) el.scroll.scrollTop = previousScroll;

    state.renderedDay = today;
    applySearch();
    updateNextUp();
  }

  function applySearch() {
    const query = state.query.trim().toLowerCase();
    const active = Boolean(query);

    el.grid.querySelectorAll('.event, .md-event').forEach((node) => {
      const ev = state.events.find((item) => item.id === node.dataset.id);
      if (!ev) return;
      const hit = !active || searchHaystack(ev).includes(query);
      node.classList.toggle('is-dimmed', active && !hit);
      node.classList.toggle('is-match', active && hit);
    });

    if (state.view === 'month') {
      el.grid.querySelectorAll('.month-day').forEach((cell) => {
        const hit = Array.from(cell.querySelectorAll('.md-event'))
          .some((node) => node.classList.contains('is-match'));
        cell.classList.toggle('is-dimmed', active && !hit);
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Next up + now line
   * ------------------------------------------------------------------ */

  function findNextUp() {
    const now = new Date();
    const today = isoDate(now);
    const nowMinutes = minutesOfDay(now);
    const candidates = state.events.filter(
      (ev) => ev.date > today || (ev.date === today && ev.end > nowMinutes)
    );
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.start - b.start;
    });
    return candidates[0];
  }

  function updateNextUp() {
    const ev = findNextUp();
    state.nextUpId = ev ? ev.id : null;

    if (!ev) {
      el.nextUp.hidden = true;
      return;
    }

    el.nextUp.hidden = false;
    const now = new Date();
    const today = isoDate(now);
    const minutes = minutesOfDay(now);
    const happeningNow = ev.date === today && ev.start <= minutes && ev.end > minutes;

    let when;
    if (happeningNow) {
      when = 'Happening now';
    } else if (ev.date === today) {
      when = `Next · ${formatTime(ev.start)}`;
    } else if (ev.date === isoDate(addDays(now, 1))) {
      when = `Next · Tomorrow ${formatTime(ev.start)}`;
    } else {
      const dateLabel = new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }).format(parseISODate(ev.date));
      when = `Next · ${dateLabel} ${formatTime(ev.start)}`;
    }

    el.nextUpWhen.textContent = when;
    el.nextUpTitle.textContent = ev.title;
    el.nextUpTitle.title = ev.title;
    el.nextUpMain.dataset.id = ev.id;

    const status = statusKey(ev.status);
    el.nextUpStatus.hidden = !status;
    if (status) {
      el.nextUpStatus.dataset.status = status;
      el.nextUpStatus.textContent = STATUS_LABELS[status];
      el.nextUpStatus.title = STATUS_LABELS[status];
    } else {
      delete el.nextUpStatus.dataset.status;
      el.nextUpStatus.textContent = '';
      el.nextUpStatus.removeAttribute('title');
    }

    el.nextUpMain.setAttribute(
      'aria-label',
      `${when}: ${ev.title}${status ? `, ${STATUS_LABELS[status]}` : ''}. Edit appointment.`
    );

    if (ev.phone && hasDialable(ev.phone)) {
      el.nextUpCall.hidden = false;
      el.nextUpCall.href = telHref(ev.phone);
      el.nextUpCall.title = `Call ${ev.phone}`;
      el.nextUpCall.setAttribute('aria-label', `Call ${ev.phone}`);
    } else {
      el.nextUpCall.hidden = true;
    }
  }

  function updateNowLine() {
    const percent = (minutesOfDay(new Date()) / DAY_MIN) * 100;
    document.querySelectorAll('.now-line').forEach((node) => {
      node.style.setProperty('--now', `${percent}%`);
    });
    updateNextUp();
  }

  function scrollToRelevantTime() {
    if (state.view === 'month') {
      el.scroll.scrollTop = 0;
      return;
    }
    window.requestAnimationFrame(() => {
      const days = visibleDays();
      const today = isoDate(new Date());
      const hasToday = days.some((day) => isoDate(day) === today);
      const target = hasToday
        ? clamp(minutesOfDay(new Date()) - 90, 0, DAY_MIN - 60)
        : 7 * 60;
      const column = el.grid.querySelector('.day-col');
      if (!column) return;
      const y = column.offsetTop + (target / DAY_MIN) * column.offsetHeight;
      el.scroll.scrollTop = clamp(y - 16, 0, Math.max(0, el.scroll.scrollHeight - el.scroll.clientHeight));
    });
  }

  /* ------------------------------------------------------------------ *
   * Navigation
   * ------------------------------------------------------------------ */

  function setView(view) {
    if (view !== 'day' && view !== 'week' && view !== 'month') return;
    state.view = view;
    syncViewButtons();
    render({ preserveScroll: false });
    scrollToRelevantTime();
  }

  function syncViewButtons() {
    el.viewButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
    });
    const suffix = state.view;
    el.prev.setAttribute('aria-label', `Previous ${suffix}`);
    el.next.setAttribute('aria-label', `Next ${suffix}`);
  }

  function step(direction) {
    if (state.view === 'month') {
      state.cursor = addMonths(state.cursor, direction);
    } else {
      const amount = state.view === 'day' ? 1 : 7;
      state.cursor = addDays(startOfDay(state.cursor), direction * amount);
    }
    render({ preserveScroll: false });
    scrollToRelevantTime();
  }

  function goToday() {
    state.cursor = startOfDay(new Date());
    render({ preserveScroll: false });
    scrollToRelevantTime();
  }

  function defaultDraft() {
    const now = new Date();
    const today = isoDate(now);
    const days = visibleDays();
    const inRange = (iso) => days.some((day) => isoDate(day) === iso);

    let date;
    if (state.view === 'month') {
      const sameMonth = state.cursor.getFullYear() === now.getFullYear()
        && state.cursor.getMonth() === now.getMonth();
      date = isoDate(sameMonth ? startOfDay(now) : state.cursor);
    } else if (state.view === 'day') {
      date = isoDate(state.cursor);
    } else if (inRange(today)) {
      date = today;
    } else {
      const upcoming = days.find((day) => isoDate(day) >= today);
      date = isoDate(upcoming || days[0]);
    }

    let start = 9 * 60;
    if (date === today) {
      start = clamp(Math.ceil((minutesOfDay(now) + 30) / SNAP) * SNAP, 0, 23 * 60 + 45);
    }

    return { date, start, end: Math.min(start + 30, DAY_MIN) };
  }

  /* ------------------------------------------------------------------ *
   * Appointment editor
   * ------------------------------------------------------------------ */

  function openEditor(draft) {
    const existing = draft && draft.id
      ? state.events.find((item) => item.id === draft.id)
      : null;
    const data = existing || draft || defaultDraft();

    state.editingId = existing ? existing.id : null;
    el.dialogTitle.textContent = existing ? 'Edit appointment' : 'New appointment';
    el.titleInput.value = existing ? existing.title : '';
    el.phoneInput.value = existing ? existing.phone : '';
    el.dateInput.value = data.date;
    el.startInput.value = minutesToInput(data.start);
    el.endInput.value = minutesToInput(data.end);
    el.notesInput.value = existing ? existing.notes : '';
    el.form.dataset.status = existing ? statusKey(existing.status) : '';
    syncStatusButtons();
    el.deleteBtn.hidden = !existing;
    el.icsBtn.hidden = !existing;
    el.saveBtn.textContent = existing ? 'Save changes' : 'Add appointment';
    el.form.dataset.duration = String(Math.max(SNAP, data.end - data.start));
    updateDurationNote();
    updateConflict();
    updateModalCall();
    markEditing(existing ? existing.id : null);

    if (!el.dialog.open) el.dialog.showModal();
    el.dialogBody.scrollTop = 0;
    el.titleInput.focus();
    el.titleInput.select();
  }

  function syncStatusButtons() {
    const current = statusKey(el.form.dataset.status);
    el.statusButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.status === current));
    });
  }

  function openEditorById(id) {
    if (!id) return;
    openEditor({ id });
  }

  function closeEditor() {
    if (el.dialog.open) el.dialog.close();
  }

  function markEditing(id) {
    el.grid.querySelectorAll('.event.is-editing').forEach((node) => {
      node.classList.remove('is-editing');
    });
    if (!id) return;
    const node = el.grid.querySelector(`.event[data-id="${window.CSS && CSS.escape ? CSS.escape(id) : id}"]`);
    if (node) node.classList.add('is-editing');
  }

  function readEndMinutes() {
    let end = inputToMinutes(el.endInput.value);
    const start = inputToMinutes(el.startInput.value);
    if (end === 0 && start !== null && start > 0) end = DAY_MIN;
    return end;
  }

  function updateDurationNote() {
    const start = inputToMinutes(el.startInput.value);
    const end = readEndMinutes();
    if (start === null || end === null) {
      el.durationNote.textContent = 'Choose a start and end time.';
      el.durationNote.classList.add('is-error');
      return;
    }
    const duration = end - start;
    if (duration <= 0) {
      el.durationNote.textContent = 'End time must be after the start time.';
      el.durationNote.classList.add('is-error');
      return;
    }
    el.durationNote.classList.remove('is-error');
    el.durationNote.textContent = `${formatDuration(duration)} · ${formatTime(start)} – ${formatTime(end)}`;
  }

  function updateConflict() {
    const date = el.dateInput.value;
    const start = inputToMinutes(el.startInput.value);
    const end = readEndMinutes();
    if (!date || start === null || end === null || end <= start) {
      el.conflictNote.hidden = true;
      return;
    }
    const clashes = state.events.filter((ev) => (
      ev.id !== state.editingId &&
      ev.date === date &&
      ev.start < end &&
      ev.end > start
    ));
    if (!clashes.length) {
      el.conflictNote.hidden = true;
      return;
    }
    const names = clashes.map((ev) => `“${ev.title}” (${formatTime(ev.start)}–${formatTime(ev.end)})`);
    el.conflictText.textContent = `Overlaps ${names.join(', ')}. You can still save it.`;
    el.conflictNote.hidden = false;
  }

  function updateModalCall() {
    const phone = el.phoneInput.value.trim();
    const dialable = hasDialable(phone);
    el.modalCall.hidden = !dialable;
    if (dialable) {
      el.modalCall.href = telHref(phone);
      el.modalCall.setAttribute('aria-label', `Call ${phone}`);
      el.modalCall.title = `Call ${phone}`;
    }
  }

  function shiftEndToKeepDuration() {
    const start = inputToMinutes(el.startInput.value);
    if (start === null) return;
    const duration = clamp(Number(el.form.dataset.duration) || 30, SNAP, DAY_MIN);
    const end = Math.min(start + duration, DAY_MIN);
    el.endInput.value = minutesToInput(end);
    el.form.dataset.duration = String(Math.max(SNAP, end - start));
    updateDurationNote();
    updateConflict();
  }

  function rememberDuration() {
    const start = inputToMinutes(el.startInput.value);
    const end = readEndMinutes();
    if (start === null || end === null) return;
    const duration = end - start;
    if (duration > 0) el.form.dataset.duration = String(duration);
    updateDurationNote();
    updateConflict();
  }

  function saveFromForm({ addAnother = false } = {}) {
    const title = el.titleInput.value.trim();
    const date = el.dateInput.value;
    const start = inputToMinutes(el.startInput.value);
    const end = readEndMinutes();

    if (!title) {
      el.titleInput.focus();
      return;
    }
    if (!date) {
      el.dateInput.focus();
      return;
    }
    if (start === null || end === null) {
      el.startInput.focus();
      return;
    }
    if (end <= start) {
      el.endInput.focus();
      return;
    }

    const payload = {
      date,
      start,
      end,
      title,
      phone: el.phoneInput.value.trim(),
      notes: el.notesInput.value.trim(),
      status: statusKey(el.form.dataset.status),
    };

    if (state.editingId) {
      const existing = state.events.find((item) => item.id === state.editingId);
      if (existing) Object.assign(existing, payload);
    } else {
      state.events.push({ id: uid(), ...payload });
    }

    sortEvents();
    saveEvents();

    if (addAnother) {
      const draft = { date, start, end };
      render();
      openEditor(draft);
    } else {
      closeEditor();
      render();
    }
  }

  function deleteEditingEvent() {
    const ev = state.events.find((item) => item.id === state.editingId);
    if (!ev) return;
    state.events = state.events.filter((item) => item.id !== ev.id);
    saveEvents();
    closeEditor();
    render();
  }

  /* ------------------------------------------------------------------ *
   * Menu actions, import / export
   * ------------------------------------------------------------------ */

  function openMenu() {
    el.menu.hidden = false;
    el.menuBtn.setAttribute('aria-expanded', 'true');
  }

  function closeMenu() {
    if (el.menu.hidden) return;
    el.menu.hidden = true;
    el.menuBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleMenu() {
    if (el.menu.hidden) openMenu();
    else closeMenu();
  }

  function syncClockToggle() {
    if (el.clockItem) el.clockItem.setAttribute('aria-checked', String(state.settings.clock24));
  }

  function toggleClock() {
    state.settings.clock24 = !state.settings.clock24;
    saveSettings();
    syncClockToggle();
    render();
  }

  function resolvedTheme() {
    return state.settings.theme || (lightQuery.matches ? 'light' : 'dark');
  }

  function applyTheme() {
    const theme = resolvedTheme();
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'light' ? '#e9edf3' : '#000000';
  }

  function syncThemeToggle() {
    if (el.themeItem) el.themeItem.setAttribute('aria-checked', String(resolvedTheme() === 'light'));
  }

  function toggleTheme() {
    state.settings.theme = resolvedTheme() === 'light' ? 'dark' : 'light';
    saveSettings();
    applyTheme();
    syncThemeToggle();
  }

  function slug(value) {
    return String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'appointment';
  }

  function download(filename, contents, type) {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function icsEscape(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/\r?\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  }

  function icsStamp() {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  function icsLocal(date, minutes) {
    const day = addDays(parseISODate(date), Math.floor(minutes / DAY_MIN));
    const mins = ((minutes % DAY_MIN) + DAY_MIN) % DAY_MIN;
    return `${day.getFullYear()}${pad(day.getMonth() + 1)}${pad(day.getDate())}T${pad(Math.floor(mins / 60))}${pad(mins % 60)}00`;
  }

  function buildICS(list) {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Project M//24-hour appointment calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];
    const stamp = icsStamp();

    for (const ev of list) {
      const description = [
        ev.phone ? `Phone: ${ev.phone}` : '',
        statusLabel(ev.status) ? `Hiring status: ${statusLabel(ev.status)}` : '',
        ev.notes,
      ].filter(Boolean).join('\n\n');

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${ev.id}@project-m.local`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DTSTART:${icsLocal(ev.date, ev.start)}`);
      lines.push(`DTEND:${icsLocal(ev.date, ev.end)}`);
      lines.push(`SUMMARY:${icsEscape(ev.title)}`);
      if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
      if (ev.phone) lines.push(`CONTACT:${icsEscape(ev.phone)}`);
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    return `${lines.join('\r\n')}\r\n`;
  }

  function exportJSON() {
    const payload = {
      app: 'project-m',
      version: 1,
      exportedAt: new Date().toISOString(),
      events: state.events,
    };
    download(
      `project-m-backup-${isoDate(new Date())}.json`,
      JSON.stringify(payload, null, 2),
      'application/json'
    );
  }

  function exportAllICS() {
    if (!state.events.length) return;
    download(
      `project-m-${isoDate(new Date())}.ics`,
      buildICS(state.events),
      'text/calendar;charset=utf-8'
    );
  }

  function exportOneICS(ev) {
    download(
      `${slug(ev.title)}-${ev.date}.ics`,
      buildICS([ev]),
      'text/calendar;charset=utf-8'
    );
  }

  async function handleImportFile() {
    const file = el.fileInput.files && el.fileInput.files[0];
    el.fileInput.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return;

    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (err) {
      return;
    }

    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed && parsed.events)
        ? parsed.events
        : null;
    if (!list) return;

    const incoming = list.map(normalizeEvent).filter(Boolean);
    if (!incoming.length) return;

    const ids = new Set(state.events.map((ev) => ev.id));
    for (const ev of incoming) {
      if (ids.has(ev.id)) ev.id = uid();
      ids.add(ev.id);
      state.events.push(ev);
    }
    sortEvents();
    saveEvents();
    render();
  }

  function clearAllEvents() {
    if (!state.events.length) return;
    state.events = [];
    saveEvents();
    render();
  }

  function handleMenuAction(action) {
    switch (action) {
      case 'new':
        openEditor();
        break;
      case 'today':
        goToday();
        break;
      case 'clock':
        toggleClock();
        break;
      case 'theme':
        toggleTheme();
        break;
      case 'print':
        window.print();
        break;
      case 'export-json':
        exportJSON();
        break;
      case 'export-ics':
        exportAllICS();
        break;
      case 'import':
        el.fileInput.value = '';
        el.fileInput.click();
        break;
      case 'clear':
        clearAllEvents();
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ *
   * Drag to schedule
   * ------------------------------------------------------------------ */

  function snapFromY(rect, clientY) {
    const ratio = (clientY - rect.top) / rect.height;
    return clamp(Math.round((ratio * DAY_MIN) / SNAP) * SNAP, 0, DAY_MIN);
  }

  function dragRange() {
    const start = Math.min(drag.anchor, drag.current);
    let end = Math.max(drag.anchor, drag.current);
    if (end <= start) end = Math.min(start + 30, DAY_MIN);
    return { start, end };
  }

  function drawGhost() {
    if (!drag) return;
    const { start, end } = dragRange();
    let ghost = drag.column.querySelector('.drag-ghost');
    if (!ghost) {
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      drag.column.append(ghost);
    }
    ghost.style.setProperty('--top', `${(start / DAY_MIN) * 100}%`);
    ghost.style.setProperty('--height', `${(Math.max(end - start, SNAP) / DAY_MIN) * 100}%`);
    ghost.textContent = `${formatTime(start)} – ${formatTime(end)} · ${formatDuration(end - start)}`;
  }

  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.current = clamp(snapFromY(drag.rect, event.clientY), 0, DAY_MIN);
    drawGhost();
  }

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { start, end } = dragRange();
    const date = drag.date;
    cleanupDrag();
    openEditor({ date, start, end });
  }

  function cancelDrag() {
    cleanupDrag();
  }

  function cleanupDrag() {
    if (drag) {
      drag.column.classList.remove('is-dragging');
      const ghost = drag.column.querySelector('.drag-ghost');
      if (ghost) ghost.remove();
    }
    window.removeEventListener('pointermove', moveDrag);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', cancelDrag);
    drag = null;
  }

  function startDrag(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('.event') || event.target.closest('.day-head')) return;

    const column = event.target.closest('.day-col');
    if (!column) return;

    const rect = column.getBoundingClientRect();
    const anchor = clamp(snapFromY(rect, event.clientY), 0, DAY_MIN - SNAP);
    drag = {
      column,
      date: column.dataset.date,
      rect,
      anchor,
      current: anchor,
      pointerId: event.pointerId,
    };

    column.classList.add('is-dragging');
    if (event.pointerType === 'mouse') event.preventDefault();

    drawGhost();
    window.addEventListener('pointermove', moveDrag);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', cancelDrag);
  }

  /* ------------------------------------------------------------------ *
   * Events and initialisation
   * ------------------------------------------------------------------ */

  function clearSearch() {
    state.query = '';
    if (el.dockSearch) el.dockSearch.value = '';
    if (state.view === 'month') render({ preserveScroll: true });
    else applySearch();
  }

  function openDockSearch() {
    if (!el.dock || !el.dockSearch) return;
    el.dock.classList.add('is-open');
    if (el.dockBubble) el.dockBubble.setAttribute('aria-expanded', 'true');
    window.setTimeout(() => {
      if (!el.dock.classList.contains('is-open')) return;
      el.dockSearch.focus();
      el.dockSearch.select();
    }, 320);
  }

  function closeDockSearch() {
    if (!el.dock) return;
    el.dock.classList.remove('is-open');
    if (el.dockBubble) el.dockBubble.setAttribute('aria-expanded', 'false');
    if (el.dockSearch) el.dockSearch.blur();
  }

  function toggleDockSearch() {
    if (el.dock && el.dock.classList.contains('is-open')) closeDockSearch();
    else openDockSearch();
  }

  function handleGlobalKey(event) {
    if (el.dialog.open) return;

    const isTyping = event.target instanceof Element &&
      event.target.closest('input, textarea, select, [contenteditable="true"]');

    if (event.key === 'Escape') {
      closeMenu();
      if (isTyping && event.target instanceof HTMLElement) event.target.blur();
      return;
    }
    if (isTyping) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    switch (event.key) {
      case 'n':
      case 'N':
        event.preventDefault();
        closeMenu();
        openEditor();
        break;
      case 't':
      case 'T':
        event.preventDefault();
        closeMenu();
        goToday();
        break;
      case 'd':
      case 'D':
        event.preventDefault();
        closeMenu();
        setView('day');
        break;
      case 'w':
      case 'W':
        event.preventDefault();
        closeMenu();
        setView('week');
        break;
      case 'm':
      case 'M':
        event.preventDefault();
        closeMenu();
        setView('month');
        break;
      case 'f':
      case 'F':
      case '/':
        event.preventDefault();
        closeMenu();
        openDockSearch();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        closeMenu();
        step(-1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        closeMenu();
        step(1);
        break;
      default:
        break;
    }
  }

  function bindEvents() {
    el.prev.addEventListener('click', () => step(-1));
    el.next.addEventListener('click', () => step(1));
    el.today.addEventListener('click', goToday);

    if (el.dockBubble) el.dockBubble.addEventListener('click', toggleDockSearch);
    if (el.dockAdd) el.dockAdd.addEventListener('click', () => openEditor());
    if (el.dockSearch) {
      el.dockSearch.addEventListener('input', () => {
        state.query = el.dockSearch.value;
        if (state.view === 'month') render({ preserveScroll: true });
        else applySearch();
      });
      el.dockSearch.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        if (el.dockSearch.value) clearSearch();
        closeDockSearch();
      });
    }

    el.viewButtons.forEach((button) => {
      button.addEventListener('click', () => setView(button.dataset.view));
    });

    el.statusButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const value = statusKey(button.dataset.status);
        el.form.dataset.status = statusKey(el.form.dataset.status) === value ? '' : value;
        syncStatusButtons();
      });
    });

    el.nextUpMain.addEventListener('click', () => openEditorById(state.nextUpId));

    el.menuBtn.addEventListener('click', toggleMenu);
    el.menu.addEventListener('click', (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const { action } = button.dataset;
      if (action !== 'clock' && action !== 'theme') closeMenu();
      handleMenuAction(action);
    });
    document.addEventListener('pointerdown', (event) => {
      if (el.menu.hidden) return;
      if (event.target instanceof Element && event.target.closest('.menu-wrap')) return;
      closeMenu();
    });
    document.addEventListener('keydown', handleGlobalKey);

    el.fileInput.addEventListener('change', handleImportFile);

    el.grid.addEventListener('click', (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('a')) return;
      const eventNode = event.target.closest('.event, .md-event');
      if (eventNode) {
        openEditorById(eventNode.dataset.id);
        return;
      }
      const head = event.target.closest('.day-head');
      if (head) {
        state.cursor = parseISODate(head.dataset.date);
        setView('day');
        return;
      }
      const monthDay = event.target.closest('.month-day');
      if (monthDay) {
        state.cursor = parseISODate(monthDay.dataset.date);
        setView('day');
      }
    });

    el.grid.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('a')) return;
      if (event.target.closest('.md-more')) return;
      const eventNode = event.target.closest('.event, .md-event');
      if (eventNode) {
        event.preventDefault();
        openEditorById(eventNode.dataset.id);
        return;
      }
      const monthDay = event.target.closest('.month-day');
      if (monthDay) {
        event.preventDefault();
        state.cursor = parseISODate(monthDay.dataset.date);
        setView('day');
      }
    });

    el.grid.addEventListener('pointerdown', startDrag);

    el.form.addEventListener('submit', (event) => {
      event.preventDefault();
      saveFromForm();
    });
    el.closeBtn.addEventListener('click', closeEditor);
    el.cancelBtn.addEventListener('click', closeEditor);
    el.deleteBtn.addEventListener('click', deleteEditingEvent);
    el.addAnotherBtn.addEventListener('click', () => saveFromForm({ addAnother: true }));
    el.icsBtn.addEventListener('click', () => {
      const ev = state.events.find((item) => item.id === state.editingId);
      if (ev) exportOneICS(ev);
    });
    el.phoneInput.addEventListener('input', () => {
      formatPhoneInput(el.phoneInput);
      updateModalCall();
    });
    [el.dateInput, el.startInput, el.endInput].forEach((input) => {
      input.addEventListener('input', () => {
        updateDurationNote();
        updateConflict();
      });
    });
    el.startInput.addEventListener('change', shiftEndToKeepDuration);
    el.endInput.addEventListener('change', rememberDuration);
    el.dialog.addEventListener('close', () => {
      state.editingId = null;
      markEditing(null);
    });
    el.dialog.addEventListener('click', (event) => {
      if (event.target === el.dialog) closeEditor();
    });
  }

  // ---------- Native window chrome ----------

  // The native shell serves the same page but drops the system title bar.
  // This wires the in-design window controls back to GTK.
  function setupWindowChrome() {
    let bridge = null;
    try {
      bridge = window.webkit?.messageHandlers?.projectMNative || null;
    } catch (error) {
      bridge = null;
    }
    if (!bridge) return;

    const send = (command, detail) => {
      try {
        bridge.postMessage(JSON.stringify(Object.assign({ command }, detail)));
      } catch (error) {
        /* The window stays usable even if the shell drops a message. */
      }
    };

    const root = document.documentElement;
    root.dataset.native = 'true';

    const minBtn = document.getElementById('winMinBtn');
    const maxBtn = document.getElementById('winMaxBtn');
    const closeBtn = document.getElementById('winCloseBtn');
    const bar = document.querySelector('.app-bar');

    if (minBtn) minBtn.addEventListener('click', () => send('window-minimize'));
    if (maxBtn) maxBtn.addEventListener('click', () => send('window-toggle-maximize'));
    if (closeBtn) closeBtn.addEventListener('click', () => send('window-close'));

    window.projectMWindowState = (state) => {
      const isMaximized = !!(state && state.maximized);
      root.dataset.windowMaximized = String(isMaximized);
      if (maxBtn) {
        const label = isMaximized ? 'Restore window' : 'Maximize window';
        maxBtn.setAttribute('aria-label', label);
        maxBtn.title = isMaximized ? 'Restore' : 'Maximize';
      }
    };

    const INTERACTIVE =
      'button, a, input, textarea, select, [role="menu"], [data-no-drag]';
    const isInteractive = (target) =>
      target instanceof Element && !!target.closest(INTERACTIVE);

    // Pressing empty space in the top bar starts a window move once the
    // pointer actually travels, so a double-click can still maximize.
    let dragStart = null;

    if (bar) {
      bar.addEventListener('mousedown', (event) => {
        if (event.button !== 0 || isInteractive(event.target)) return;
        if (event.detail >= 2) {
          event.preventDefault();
          send('window-toggle-maximize');
          return;
        }
        event.preventDefault();
        dragStart = {
          x: event.screenX,
          y: event.screenY,
          button: event.button,
        };
      });
    }

    window.addEventListener(
      'pointermove',
      (event) => {
        if (!dragStart) return;
        if ((event.buttons & 1) === 0) {
          dragStart = null;
          return;
        }
        if (
          Math.abs(event.screenX - dragStart.x) < 4 &&
          Math.abs(event.screenY - dragStart.y) < 4
        ) {
          return;
        }
        const start = dragStart;
        dragStart = null;
        send('window-start-drag', {
          x: Math.round(start.x),
          y: Math.round(start.y),
          button: start.button,
        });
      },
      true
    );

    window.addEventListener(
      'mouseup',
      () => {
        dragStart = null;
      },
      true
    );

    // Resize by grabbing the window edges; the shell hands this to the
    // compositor, which keeps its normal resize behaviour.
    const EDGE = 5;
    const RESIZE_CURSORS = {
      n: 'ns-resize',
      s: 'ns-resize',
      e: 'ew-resize',
      w: 'ew-resize',
      ne: 'nesw-resize',
      sw: 'nesw-resize',
      nw: 'nwse-resize',
      se: 'nwse-resize',
    };
    let currentEdge = '';

    const edgeAt = (x, y) => {
      if (root.dataset.windowMaximized === 'true') return '';
      const vertical = y <= EDGE ? 'n' : y >= window.innerHeight - EDGE ? 's' : '';
      const horizontal = x <= EDGE ? 'w' : x >= window.innerWidth - EDGE ? 'e' : '';
      return `${vertical}${horizontal}`;
    };

    window.addEventListener(
      'pointermove',
      (event) => {
        const edge = edgeAt(event.clientX, event.clientY);
        if (edge === currentEdge) return;
        currentEdge = edge;
        if (edge) {
          root.style.setProperty('--resize-cursor', RESIZE_CURSORS[edge]);
          root.dataset.resizeEdge = edge;
        } else {
          delete root.dataset.resizeEdge;
          root.style.removeProperty('--resize-cursor');
        }
      },
      true
    );

    window.addEventListener(
      'mousedown',
      (event) => {
        if (event.button !== 0) return;
        const edge = edgeAt(event.clientX, event.clientY);
        if (!edge) return;
        event.preventDefault();
        event.stopPropagation();
        send('window-start-resize', {
          edge,
          x: Math.round(event.screenX),
          y: Math.round(event.screenY),
          button: event.button,
        });
      },
      true
    );

    // Sync the maximize/restore icon with the shell.
    send('window-state');
  }

  function init() {
    setupWindowChrome();
    loadSettings();
    loadEvents();

    state.view = 'month';
    state.cursor = startOfDay(new Date());

    syncViewButtons();
    syncClockToggle();
    applyTheme();
    syncThemeToggle();
    lightQuery.addEventListener('change', () => {
      if (state.settings.theme) return;
      applyTheme();
      syncThemeToggle();
    });
    bindEvents();
    render({ preserveScroll: false });
    scrollToRelevantTime();
    closeDockSearch();

    window.setInterval(() => {
      const today = isoDate(new Date());
      if (today !== state.renderedDay) render();
      else updateNowLine();
    }, 30000);

    window.addEventListener('focus', updateNowLine);

    // Month cells show fewer chips on narrow screens; re-render when we
    // cross that breakpoint so the overflow counts stay accurate.
    const narrowQuery = window.matchMedia('(max-width: 720px)');
    const onNarrowChange = () => {
      if (state.view === 'month') render({ preserveScroll: true });
    };
    if (narrowQuery.addEventListener) narrowQuery.addEventListener('change', onNarrowChange);
    else narrowQuery.addListener(onNarrowChange);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
