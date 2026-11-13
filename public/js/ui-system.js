/* Shared presentation, dismissal and date controls. No API or form payload changes. */
(() => {
  'use strict';
  if (window.WalkinUI) return;
  const modalSelector = '.modal-backdrop > .modal, .modal-backdrop > form, .modal-bg > .sch-modal, dialog:not(.wi-calendar)';
  const dismissSelector = '[data-cancel], [data-close], [data-later], [data-act="cancel"], [data-act="close"]';
  const sessions = new Map(), dateControls = new WeakMap();
  const busyStates = new Map(), wired = new WeakSet();
  let generation = 0, currentAction = null, completionContext = null, tearingDown = false;
  let picker = null, scanPending = false, feedbackDialog = null;
  const calendarIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>';
  function resultIcon(status) {
    const mark = status === 'success' ? '<path d="M21 37l10 10 21-23"/>'
      : status === 'failure' ? '<path d="M24 24l24 24"/><path d="M48 24L24 48"/>'
        : '<path d="M36 21v20"/><path d="M36 50h.01"/>';
    return '<svg viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="31"/>' + mark + '</svg>';
  }
  function focusable(root) {
    return [...root.querySelectorAll('button,input,textarea,select,a[href],[tabindex="0"]')]
      .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  }
  function isOpen(modal) { return modal.isConnected && (modal.tagName === 'DIALOG' ? modal.open : !!modal.getClientRects().length); }
  function topDialog() {
    const native = [...document.querySelectorAll('dialog[open]:not(.wi-calendar)')].filter(isOpen);
    const active = document.activeElement?.closest('dialog[open]');
    return native.includes(active) ? active : native.at(-1) || [...document.querySelectorAll(modalSelector)].filter(isOpen).at(-1);
  }
  function busyState(modal) {
    if (!busyStates.has(modal)) busyStates.set(modal, { requests: 0, submission: null, controls: new Map(), busy: false });
    return busyStates.get(modal);
  }
  function updateBusy(modal) {
    const state = busyStates.get(modal); if (!state) return false;
    const submitted = state.submission?.isConnected && [...state.submission.elements].some(button => button.type === 'submit' && button.disabled);
    if (!submitted) state.submission = null;
    const busy = state.requests > 0 || !!submitted;
    if (busy !== state.busy) {
      state.busy = busy; modal.setAttribute('aria-busy', String(busy));
      if (busy) modal.querySelectorAll('.wi-close,' + dismissSelector).forEach(control => { state.controls.set(control, !!control.disabled); control.disabled = true; });
      else { state.controls.forEach((disabled, control) => { control.disabled = disabled; }); state.controls.clear(); }
    }
    return busy;
  }
  function staleError() { const error = new Error('This view is no longer active.'); error.name = 'AbortError'; error.code = 'UI_PAGE_CHANGED'; return error; }
  function isStale() { return !!completionContext && (completionContext.cancelled || completionContext.generation !== generation); }
  function beginRequest(options = {}) {
    const origin = currentAction || completionContext;
    const mutation = !['GET','HEAD'].includes(String(options.method || 'GET').toUpperCase());
    const sourceModal = options.modal || origin?.modal || (mutation ? document.activeElement?.closest(modalSelector) : null);
    const modal = sourceModal && !sourceModal.classList.contains('wi-feedback') && isOpen(sourceModal) ? sourceModal : null;
    const token = { generation: tearingDown ? generation - 1 : origin?.generation ?? generation, modal };
    if (mutation && modal?.isConnected) { busyState(modal).requests++; updateBusy(modal); }
    let finished = false;
    const finish = () => {
      if (finished) return; finished = true;
      token.cancelled = finish.isStale();
      if (mutation && busyStates.has(modal)) { const state = busyState(modal); state.requests = Math.max(0, state.requests - 1); updateBusy(modal); }
      completionContext = token;
      setTimeout(() => { if (completionContext === token) completionContext = null; }, 0);
    };
    finish.isStale = () => token.generation !== generation || !!token.modal && !isOpen(token.modal);
    return finish;
  }
  function cleanup() {
    const previousGeneration = generation++; tearingDown = true; closePicker(false);
    try {
      for (const modal of [...document.querySelectorAll(modalSelector)].reverse()) {
        const state = busyStates.get(modal); if (state) { state.requests = 0; state.submission = null; updateBusy(modal); }
        modal.dispatchEvent(new Event('wi:dispose'));
        if (modal.isConnected && isOpen(modal)) (modal.querySelector('.wi-close') || modal.querySelector(dismissSelector))?.click();
        if (modal.isConnected) { if (modal.tagName === 'DIALOG') { if (modal.open) modal.close(); modal.remove(); } else modal.parentElement?.remove(); }
      }
    } finally {
      tearingDown = false; sessions.clear(); busyStates.clear(); feedbackDialog = null; currentAction = null;
      const old = { generation: previousGeneration, modal: null }; completionContext = old;
      setTimeout(() => { if (completionContext === old) completionContext = null; }, 0);
      document.documentElement.classList.remove('wi-has-dialog');
    }
  }
  function enhanceModal(modal) {
    if (!modal.matches(modalSelector)) return;
    modal.classList.add('wi-dialog');
    if (!wired.has(modal)) {
      wired.add(modal);
      modal.addEventListener('cancel', event => { if (updateBusy(modal)) event.preventDefault(); });
    }
    const locked = modal.parentElement?.hasAttribute('data-locked') || modal.hasAttribute('data-locked');
    let close = modal.querySelector('.wi-close, .modal-corner-x, .modal-close');
    if (!close && !locked) {
      // Reuse a header control, keeping its original handler and cleanup callback.
      close = [...modal.querySelectorAll('button')].find(b => /^(close|×|✕|x)$/i.test(b.textContent.trim()) &&
        (b.closest('.between, .dialog-heading, .staff-create-head') || b.matches('[data-close][aria-label="Close"]')));
      if (!close) {
        close = document.createElement('button'); close.type = 'button';
        close.addEventListener('click', () => {
          const delegate = [...modal.querySelectorAll(dismissSelector)].find(b => b !== close && !b.classList.contains('wi-close'));
          if (delegate) delegate.click();
          else if (modal.tagName === 'DIALOG') modal.close();
          else modal.parentElement.remove();
        });
        modal.prepend(close);
      }
    }
    if (close && !locked) {
      close.classList.add('wi-close'); close.setAttribute('aria-label', 'Close'); close.title = 'Close';
      if (close.textContent !== '×') close.textContent = '×';
      modal.querySelectorAll('button, a.btn').forEach(button => {
        if (button !== close && (/^close$/i.test(button.textContent.trim()) || button.matches('[data-close]') && /^[×✕x]$/i.test(button.textContent.trim()))) {
          // Callers often focus their footer Close on open; hiding it drops focus, so hand it to the ×.
          const hadFocus = document.activeElement === button;
          // Keep the node: callers bind to it after appending the modal, and × delegates to it.
          button.classList.add('wi-close-duplicate'); button.tabIndex = -1; button.setAttribute('aria-hidden', 'true');
          if (hadFocus) close.focus({ preventScroll: true });
        }
      });
    }
    modal.querySelectorAll('.flex,.foot,.dialog-actions,.se-footer,.at-form-foot,.lecture-modal-foot').forEach(group => {
      const parent = group.parentElement;
      const isFooter = group.matches('.foot,.dialog-actions,.se-footer,.at-form-foot,.lecture-modal-foot') ||
        group === parent.lastElementChild && (parent === modal || parent.tagName === 'FORM');
      if (!isFooter || !group.querySelector('button,a.btn')) return;
      group.classList.add('wi-dialog-actions');
      const buttons = [...group.querySelectorAll('button,a.btn')];
      group.classList.toggle('wi-empty-actions', buttons.every(b => b.classList.contains('wi-close-duplicate')) && !group.querySelector('input,select,textarea'));
    });
    const status = modal.dataset.uiStatus;
    if (status) {
      modal.classList.add('wi-centered');
      if (!modal.querySelector(':scope > .wi-result-icon')) {
        const icon = document.createElement('div'); icon.className = 'wi-result-icon'; icon.setAttribute('aria-hidden', 'true'); icon.innerHTML = resultIcon(status);
        const heading = modal.querySelector('h2,h3'); modal.insertBefore(icon, heading?.parentElement === modal ? heading : close?.nextSibling || modal.firstChild);
      }
    }
    updateBusy(modal);
    if (isOpen(modal) && !sessions.has(modal)) {
      const previous = document.activeElement; sessions.set(modal, previous);
      if (!modal.hasAttribute('tabindex')) modal.tabIndex = -1;
      if (modal.tagName !== 'DIALOG') { modal.setAttribute('role', modal.getAttribute('role') || 'dialog'); modal.setAttribute('aria-modal', 'true'); }
      if (!modal.getAttribute('aria-label') && !modal.getAttribute('aria-labelledby')) {
        const heading = modal.querySelector('h2,h3'); if (heading) { if (!heading.id) heading.id = 'wi-dialog-title-' + (++enhanceModal.serial); modal.setAttribute('aria-labelledby', heading.id); }
      }
      queueMicrotask(() => {
        if (!isOpen(modal) || modal.contains(document.activeElement) && document.activeElement !== modal) return;
        const fields = focusable(modal); (fields.find(el => el.matches('[autofocus],input,textarea,select,.wi-date-trigger')) || fields.find(el => !el.classList.contains('wi-close')) || modal).focus({ preventScroll: true });
      });
    }
  }
  enhanceModal.serial = 0;
  function scan() {
    scanPending = false;
    document.querySelectorAll(modalSelector).forEach(enhanceModal);
    document.querySelectorAll('input[type="date"],input[type="datetime-local"],input[type="month"]').forEach(enhanceDate);
    for (const [modal, previous] of sessions) if (!isOpen(modal)) {
      sessions.delete(modal);
      busyStates.delete(modal);
      modal.dispatchEvent(new Event('wi:dispose'));
      if (previous?.isConnected && (document.activeElement === document.body || modal.contains(document.activeElement))) previous.focus({ preventScroll: true });
    }
    if (picker && (!picker.input.isConnected || picker.input.disabled || picker.input.readOnly || !picker.input.getClientRects().length)) closePicker(false);
    const open = [...sessions.keys()].some(isOpen);
    if (document.documentElement.classList.contains('wi-has-dialog') !== open) document.documentElement.classList.toggle('wi-has-dialog', open);
  }
  function scheduleScan() { if (!scanPending) { scanPending = true; queueMicrotask(scan); } }
  // Closes itself after 2.3s (shown 2.05s, then a 250ms fade) unless dismissed first.
  function feedback(message, status = 'success', title, { autoClose = 2050 } = {}) {
    if (tearingDown || isStale()) return { close() {} };
    feedbackDialog?.close(); feedbackDialog?.remove();
    const modal = document.createElement('dialog'); modal.className = 'modal wi-feedback'; modal.dataset.uiStatus = status;
    const heading = document.createElement('h3'); heading.textContent = title || (status === 'failure' ? 'Something went wrong' : 'Success');
    const text = document.createElement('p'); text.className = 'wi-feedback-message'; text.textContent = String(message); text.setAttribute('role', status === 'failure' ? 'alert' : 'status');
    const done = document.createElement('button'); done.type = 'button'; done.className = 'btn btn-primary wi-feedback-done'; done.dataset.close = ''; done.textContent = 'Done';
    const previous = document.activeElement;
    const previousOpener = sessions.get(previous?.closest('.wi-dialog')) || [...sessions].reverse().find(([dialog]) => !isOpen(dialog))?.[1];
    let dismissed = false, fadeTimer = null;
    const autoTimer = autoClose > 0 ? setTimeout(() => { modal.style.transition = 'opacity .25s'; modal.style.opacity = '0'; fadeTimer = setTimeout(dismiss, 250); }, autoClose) : null;
    const dismiss = () => { if (dismissed) return; dismissed = true; clearTimeout(autoTimer); clearTimeout(fadeTimer); if (modal.open) modal.close(); modal.remove(); if (feedbackDialog === modal) feedbackDialog = null; let target = previous?.isConnected && previous !== document.body ? previous : previousOpener || previous;
      // A dialog opened underneath while this one showed (e.g. Message client): focus goes into it, not the page behind.
      const below = topDialog(); if (below && !below.contains(target)) target = focusable(below).find(el => !el.classList.contains('wi-close')) || below;
      if (target?.isConnected) target.focus({ preventScroll: true }); };
    done.onclick = dismiss; modal.addEventListener('cancel', e => { e.preventDefault(); dismiss(); });
    modal.addEventListener('wi:dispose', dismiss, { once: true });
    modal.append(heading, text, done); document.body.append(modal); feedbackDialog = modal; modal.showModal(); enhanceModal(modal); done.focus();
    return { close: dismiss };
  }
  const isoDate = date => [String(date.getUTCFullYear()).padStart(4, '0'), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('-');
  function asDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || ''); if (!match || +match[1] < 1) return null;
    const date = new Date(0); date.setUTCHours(0, 0, 0, 0); date.setUTCFullYear(+match[1], +match[2] - 1, +match[3]);
    return isoDate(date) === value ? date : null;
  }
  function today() { const now = new Date(); return String(now.getFullYear()).padStart(4, '0') + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'); }
  function addDays(value, amount) { const date = asDate(value); date.setUTCDate(date.getUTCDate() + amount); return isoDate(date); }
  function displayDate(value) {
    if (/^\d{4}-\d{2}$/.test(value) && asDate(value + '-01')) return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(asDate(value + '-01'));
    const date = asDate(value.slice(0, 10)); if (!date) return '';
    const formatted = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
    return formatted + (value.includes('T') ? ' · ' + value.split('T')[1] : '');
  }
  function manualDate(value) {
    if (!value.trim()) return '';
    if (asDate(value.trim())) return value.trim();
    const m = /^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/.exec(value.trim());
    const iso = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
    return iso && asDate(iso) ? iso : null;
  }
  function printedDate(value) { return asDate(value) ? value.slice(8, 10) + ' / ' + value.slice(5, 7) + ' / ' + value.slice(0, 4) : ''; }
  const dateKind = input => input.getAttribute('type').toLowerCase();
  function enhanceDate(input) {
    if (input.closest('.wi-calendar') || input.dataset.nativePicker !== undefined) return;
    if (dateControls.has(input)) { dateControls.get(input).sync(); return; }
    const labelCopy = input.labels?.[0]?.cloneNode(true);
    labelCopy?.querySelectorAll('input,button,select,textarea').forEach(node => node.remove());
    const label = input.getAttribute('aria-label') || (labelCopy?.textContent || input.name || 'date').trim().replace(/\s+/g, ' ');
    // Edit forms may clone an already enhanced creation form. Rebind its
    // controls instead of nesting a second picker around the cloned input.
    const wrapper = input.parentElement?.classList.contains('wi-date-control') ? input.parentElement : document.createElement('span'); wrapper.className = 'wi-date-control';
    const trigger = wrapper.querySelector(':scope > .wi-date-trigger') || document.createElement('button'); trigger.type = 'button'; trigger.className = 'wi-date-trigger'; trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = calendarIcon + '<span></span>'; trigger.setAttribute('aria-label', 'Choose ' + label);
    const clear = wrapper.querySelector(':scope > .wi-date-clear') || document.createElement('button'); clear.type = 'button'; clear.className = 'wi-date-clear'; clear.textContent = '×'; clear.setAttribute('aria-label', 'Clear ' + label); clear.title = 'Clear date';
    if (input.parentElement !== wrapper) input.before(wrapper);
    wrapper.append(input, trigger, clear); input.classList.add('wi-date-native'); input.tabIndex = -1; input.setAttribute('aria-hidden', 'true');
    const sync = () => {
      if (picker?.baseline) {
        const index = picker.fields.indexOf(input);
        if (index >= 0 && [input.value,input.min,input.max,input.step,input.required,input.disabled,input.readOnly].join('|') !== picker.baseline[index]) closePicker(false);
      }
      const text = displayDate(input.value) || input.getAttribute('placeholder') || (dateKind(input) === 'month' ? 'Choose month' : dateKind(input) === 'datetime-local' ? 'Choose date & time' : 'Choose date');
      if (trigger.lastElementChild.textContent !== text) trigger.lastElementChild.textContent = text;
      const disabled = input.disabled || input.readOnly;
      if (trigger.disabled !== disabled) trigger.disabled = disabled;
      clear.hidden = !input.value || input.required || input.disabled || input.readOnly;
      if (input.getAttribute('aria-describedby')) trigger.setAttribute('aria-describedby', input.getAttribute('aria-describedby'));
    };
    dateControls.set(input, { trigger, clear, wrapper, sync, label });
    // Existing pages commonly set .value programmatically after loading a record.
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!Object.getOwnPropertyDescriptor(input, 'value')) Object.defineProperty(input, 'value', { configurable: true, get() { return descriptor.get.call(this); }, set(value) { descriptor.set.call(this, value); sync(); } });
    trigger.onclick = () => { if (picker?.input === input) closePicker(); else openPicker(input); };
    clear.onclick = () => { input.value = ''; changed(input); trigger.focus(); };
    input.addEventListener('input', sync); input.addEventListener('change', sync);
    input.addEventListener('focus', () => trigger.focus({ preventScroll: true }));
    input.addEventListener('invalid', event => { event.preventDefault(); openPicker(input); if (picker) picker.error.textContent = input.validationMessage; });
    input.form?.addEventListener('reset', () => setTimeout(sync, 0)); sync();
  }
  function changed(input) { dateControls.get(input)?.sync(); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }
  function rangeFor(input) {
    if (dateKind(input) !== 'date') return null;
    const scope = input.form || input.closest('.filters,.filter-bar,.filter-form') || input.parentElement?.parentElement;
    if (!scope) return null;
    const candidates = [...scope.querySelectorAll('input[type=date]')].filter(el => !el.disabled && !el.readOnly && !el.closest('.wi-calendar'));
    const key = el => (el.name || el.id).toLowerCase().replace(/[-_]/g, '');
    for (const [a, b] of [['from','to'], ['ffrom','fto'], ['fromdate','todate'], ['startdate','enddate']]) {
      const start = candidates.find(el => key(el) === a), end = candidates.find(el => key(el) === b);
      if (start && end && (start === input || end === input)) return [start, end];
    }
    return null;
  }
  function closePicker(restore = true) {
    if (!picker) return;
    const old = picker; picker = null;
    document.documentElement.classList.remove('wi-has-calendar');
    if (typeof old.panel.hidePopover === 'function' && old.panel.matches(':popover-open')) old.panel.hidePopover(); old.panel.remove();
    dateControls.get(old.input)?.trigger.setAttribute('aria-expanded', 'false');
    if (restore && old.input.isConnected) dateControls.get(old.input)?.trigger.focus({ preventScroll: true });
  }
  // Shortcut icons: a calendar showing a day number, or one with a mark for the kind of choice.
  function shortcutIcon(kind) {
    if (kind === 'none') return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M6 18L18 6"/></svg>';
    const mark = typeof kind === 'number' ? `<text x="12" y="18.2" text-anchor="middle">${kind}</text>`
      : '<path d="' + ({ next: 'M8.5 15h7M13 12.5l2.5 2.5-2.5 2.5', period: 'M7.5 14h9M7.5 17.5h5', custom: 'M8 13.5h2M12 13.5h2M8 17h2' }[kind]) + '"/>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M3.5 9h17M8 3v3M16 3v3"/>' + mark + '</svg>';
  }
  function makeButton(text, action, className) { const button = document.createElement('button'); button.type = 'button'; button.textContent = text; if (className) button.className = className; if (action) button.onclick = action; return button; }
  function openPicker(input) {
    if (input.disabled || input.readOnly || !input.isConnected) return;
    closePicker(false);
    const control = dateControls.get(input); if (!control) return;
    const range = rangeFor(input), fields = range || [input], time = dateKind(input) === 'datetime-local', monthOnly = dateKind(input) === 'month';
    // A single date or month applies as soon as it is picked; ranges and date & time keep Apply.
    const instant = !range && !time;
    const panel = document.createElement('div'); panel.className = 'wi-calendar'; panel.setAttribute('popover', 'manual'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', range ? 'Choose date range' : 'Choose ' + control.label);
    const initial = (monthOnly && input.value ? input.value + '-01' : input.value.slice(0, 10)) || today(), date = asDate(initial) || asDate(today());
    const state = { input, fields, range, time, panel, year: date.getUTCFullYear(), month: date.getUTCMonth(), phase: range?.indexOf(input) || 0, values: fields.map(el => el.value ? el.value.slice(0, 10) + (monthOnly ? '-01' : '') : ''), editors: [] }; picker = state;
    state.baseline = fields.map(field => [field.value,field.min,field.max,field.step,field.required,field.disabled,field.readOnly].join('|'));
    const print = value => monthOnly ? (value ? value.slice(5, 7) + ' / ' + value.slice(0, 4) : '') : printedDate(value);
    const parse = value => { if (!monthOnly) return manualDate(value); if (!value.trim()) return ''; const m = /^(\d{1,2})\s*\/\s*(\d{4})$/.exec(value.trim()); const iso = /^\d{4}-\d{2}$/.test(value.trim()) ? value.trim() + '-01' : m ? `${m[2]}-${m[1].padStart(2,'0')}-01` : ''; return asDate(iso) ? iso : null; };
    const fieldName = String(control.label || 'date').replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
    const nav = document.createElement('div'); nav.className = 'wi-calendar-nav';
    const moveMonth = amount => { const next = new Date(0); next.setUTCFullYear(state.year + (monthOnly ? amount : 0), state.month + (monthOnly ? 0 : amount), 1); if (next.getUTCFullYear() < 1 || next.getUTCFullYear() > 9999) return; state.year = next.getUTCFullYear(); state.month = next.getUTCMonth(); draw(); };
    const monthButton = makeButton('', () => { jump.hidden = !jump.hidden; if (!jump.hidden) yearInput.focus(); }, 'wi-calendar-month');
    const prev = makeButton('‹', () => moveMonth(-1)); prev.setAttribute('aria-label', 'Previous month');
    const next = makeButton('›', () => moveMonth(1)); next.setAttribute('aria-label', 'Next month'); nav.append(prev, monthButton, next);
    const jump = document.createElement('div'); jump.className = 'wi-calendar-jump'; jump.hidden = true;
    const monthSelect = document.createElement('select'); monthSelect.setAttribute('aria-label', 'Month');
    for (let m = 0; m < 12; m++) { const option = document.createElement('option'); option.value = m; option.textContent = new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, m, 1))); monthSelect.append(option); }
    const yearInput = document.createElement('input'); yearInput.type = 'number'; yearInput.min = '1'; yearInput.max = '9999'; yearInput.setAttribute('aria-label', 'Year');
    monthSelect.onchange = () => { state.month = +monthSelect.value; draw(); }; yearInput.onchange = () => { const year = +yearInput.value; if (year >= 1 && year <= 9999) { state.year = year; draw(); } };
    jump.append(monthSelect, yearInput);
    if (monthOnly) { monthSelect.hidden = true; jump.classList.add('wi-month-jump'); }
    const weekdays = document.createElement('div'); weekdays.className = 'wi-calendar-weekdays'; weekdays.setAttribute('aria-hidden', 'true');
    for (const day of ['Mo','Tu','We','Th','Fr','Sa','Su']) { const cell = document.createElement('span'); cell.textContent = day; weekdays.append(cell); }
    const grid = document.createElement('div'); grid.className = 'wi-calendar-grid' + (monthOnly ? ' wi-month-grid' : ''); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', monthOnly ? 'Months' : 'Dates'); weekdays.hidden = monthOnly;
    const editors = document.createElement('div'); editors.className = 'wi-calendar-editor' + (range || time ? ' wi-calendar-pair' : ' wi-calendar-row');
    fields.forEach((field, index) => {
      // A single date sits beside its field name ("Due date  24 / 11 / 2026").
      const label = document.createElement('label'), caption = document.createElement('span'); label.append(caption);
      caption.textContent = instant ? fieldName : range ? (index ? 'To' : 'From') : 'Selected date';
      const editor = document.createElement('input'); editor.type = 'text'; editor.placeholder = monthOnly ? 'MM / YYYY' : 'DD / MM / YYYY'; editor.inputMode = 'numeric'; editor.autocomplete = 'off'; editor.value = print(state.values[index]);
      editor.onfocus = () => { state.phase = index; };
      // Do not collapse an existing validation message on blur: that can move
      // Apply between pointer-down and click. Successful Apply closes the panel.
      editor.onchange = () => { const value = parse(editor.value); if (value === null) return; state.values[index] = value; if (value) { const d = asDate(value); state.year = d.getUTCFullYear(); state.month = d.getUTCMonth(); } draw(); };
      label.append(editor); editors.append(label); state.editors.push(editor);
    });
    let timeInput;
    if (time) { const label = document.createElement('label'); label.textContent = 'Time'; timeInput = document.createElement('input'); timeInput.type = 'time'; timeInput.step = input.step || (input.value.split('T')[1]?.length > 5 ? '1' : '60'); timeInput.value = input.value.split('T')[1] || '09:00'; label.append(timeInput); editors.append(label); }
    const shortcuts = document.createElement('div'); shortcuts.className = 'wi-calendar-shortcuts';
    const error = document.createElement('p'); error.className = 'wi-calendar-error'; error.setAttribute('role', 'alert'); state.error = error;
    function selectDate(value) {
      state.values[state.phase] = value;
      if (range) {
        if (state.phase === 0 && state.values[1] && state.values[1] < value) state.values[1] = '';
        else if (state.phase === 1 && state.values[0] && value < state.values[0]) { state.values = [value, '']; state.phase = 0; }
        state.phase = state.phase ? 0 : 1;
      }
      state.editors.forEach((editor, index) => { editor.value = print(state.values[index]); }); error.textContent = ''; draw();
      if (instant) apply();
    }
    function dateAllowed(value) { const field = fields[state.phase], compare = monthOnly ? value.slice(0, 7) : value; return (!field.min || compare >= field.min.slice(0, monthOnly ? 7 : 10)) && (!field.max || compare <= field.max.slice(0, monthOnly ? 7 : 10)); }
    function draw(focusValue) {
      const first = new Date(0); first.setUTCFullYear(state.year, state.month, 1); first.setUTCHours(0, 0, 0, 0);
      monthButton.textContent = monthOnly ? String(state.year) : new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
      monthSelect.value = state.month; yearInput.value = state.year;
      const offset = (first.getUTCDay() + 6) % 7; first.setUTCDate(1 - offset);
      grid.replaceChildren();
      for (let i = 0; i < (monthOnly ? 12 : 42); i++) {
        const d = new Date(first); if (monthOnly) d.setUTCFullYear(state.year, i, 1); else d.setUTCDate(first.getUTCDate() + i); const value = isoDate(d);
        const button = makeButton(monthOnly ? new Intl.DateTimeFormat('en-GB',{month:'short',timeZone:'UTC'}).format(d) : String(d.getUTCDate()), () => selectDate(value)); button.dataset.date = value;
        button.setAttribute('aria-label', displayDate(value)); button.disabled = !dateAllowed(value) || d.getUTCFullYear() < 1 || d.getUTCFullYear() > 9999;
        if (!monthOnly && d.getUTCMonth() !== state.month) button.dataset.outside = '';
        if (state.values.includes(value)) { button.dataset.selected = ''; button.setAttribute('aria-pressed', 'true'); }
        if (range && state.values[0] && state.values[1] && value > state.values[0] && value < state.values[1]) button.dataset.inRange = '';
        if (value === today()) button.dataset.today = '';
        button.tabIndex = value === (focusValue || state.values[state.phase] || initial) ? 0 : -1; grid.append(button);
      }
      if (!grid.querySelector('[tabindex="0"]:not(:disabled)')) { const available = grid.querySelector('button:not(:disabled):not([data-outside])'); if (available) available.tabIndex = 0; }
      if (focusValue) grid.querySelector(`[data-date="${focusValue}"]`)?.focus();
      // Highlight the shortcut matching the current choice: a named one, else Custom, else No date.
      const [start, end] = state.values;
      const match = [...shortcuts.children].find(b => b.dataset.start && b.dataset.start === start && (!range || b.dataset.end === end))
        || shortcuts.querySelector(start ? '[data-custom]' : '[data-none]');
      for (const b of shortcuts.children) { if (b === match) { b.dataset.active = ''; b.setAttribute('aria-current', 'true'); } else { delete b.dataset.active; b.removeAttribute('aria-current'); } }
    }
    function apply(clear = false) {
      if (fields.some((field, index) => [field.value,field.min,field.max,field.step,field.required,field.disabled,field.readOnly].join('|') !== state.baseline[index])) { closePicker(); return; }
      const values = fields.map((field, index) => {
        const date = clear ? '' : parse(state.editors[index].value);
        if (date === null) return null;
        return monthOnly && date ? date.slice(0, 7) : date && time ? date + 'T' + timeInput.value : date;
      });
      if (values.includes(null) || time && values[0] && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(timeInput.value)) { error.textContent = monthOnly ? 'Enter a valid month as MM / YYYY.' : 'Enter a valid date' + (time ? ' and time.' : ' as DD / MM / YYYY.'); return; }
      if (range && values[0] && values[1] && values[1] < values[0]) { error.textContent = 'The end date must be on or after the start date.'; return; }
      for (let i = 0; i < fields.length; i++) {
        // Some WebKit builds fall back to text for date inputs. Validate the
        // declared type too, rather than relying solely on native validity.
        const field = fields[i], value = values[i];
        if (!value && field.required) { error.textContent = 'Choose a date before continuing.'; return; }
        if (value && asDate(field.min.slice(0, 10) + (monthOnly && field.min ? '-01' : '')) && value < field.min) { error.textContent = 'Choose a date on or after ' + displayDate(field.min) + '.'; return; }
        if (value && asDate(field.max.slice(0, 10) + (monthOnly && field.max ? '-01' : '')) && value > field.max) { error.textContent = 'Choose a date on or before ' + displayDate(field.max) + '.'; return; }
        if (value && field.type === 'text' && field.step !== 'any') {
          const numeric = text => { if (monthOnly) return Number(text.slice(0,4)) * 12 + Number(text.slice(5,7)) - 1; const d = asDate(text.slice(0, 10)); if (!d) return 0; const parts = (text.split('T')[1] || '00:00').split(':').map(Number); return d.getTime() + (parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0)) * 1000; };
          const step = Number(field.step || (time ? 60 : 1)) * (monthOnly ? 1 : time ? 1000 : 86400000);
          const base = field.min || field.getAttribute('value') || '1970-01-01';
          if (step > 0 && Math.abs((numeric(value) - numeric(base)) / step - Math.round((numeric(value) - numeric(base)) / step)) > 1e-7) { error.textContent = 'Choose a value that matches the allowed date or time interval.'; return; }
        }
        const validator = fields[i].cloneNode(false); validator.removeAttribute('id'); validator.value = values[i];
        if (!validator.checkValidity()) { error.textContent = validator.validationMessage; return; }
      }
      // Commit both ends before notifying existing range/filter listeners.
      closePicker(); fields.forEach((field, index) => { field.value = values[index]; }); fields.forEach(changed);
    }
    const iconButton = (label, icon, action) => { const button = makeButton('', action); button.innerHTML = shortcutIcon(icon) + '<span></span>'; button.lastChild.textContent = label; shortcuts.append(button); return button; };
    const shortcut = (label, icon, start, end) => {
      const button = iconButton(label, icon, () => {
        if (range) { state.values = [start, end || start]; state.phase = 0; state.editors.forEach((editor, index) => { editor.value = print(state.values[index]); }); }
        else { state.values[0] = start; state.editors[0].value = print(start); }
        const d = asDate(start); state.year = d.getUTCFullYear(); state.month = d.getUTCMonth(); error.textContent = ''; draw();
        if (instant) apply();
      });
      button.dataset.start = start; if (range) button.dataset.end = end || start;
    };
    if (monthOnly) {
      const current = today().slice(0, 7) + '-01', next = asDate(current); next.setUTCMonth(next.getUTCMonth() + 1); shortcut('This month', 'period', current); shortcut('Next month', 'next', isoDate(next));
    } else shortcut('Today', Number(today().slice(8)), today());
    if (range) {
      const d = asDate(today()), monday = addDays(today(), -((d.getUTCDay() + 6) % 7)); shortcut('This week', 'period', monday, addDays(monday, 6));
      const first = today().slice(0, 8) + '01', last = asDate(first); last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0); shortcut('This month', 'period', first, isoDate(last));
    } else if (!monthOnly) { shortcut('Tomorrow', Number(addDays(today(), 1).slice(8)), addDays(today(), 1)); shortcut('Next week', 'next', addDays(today(), 7)); }
    iconButton(range ? 'Custom range…' : 'Custom…', 'custom', () => state.editors[0].focus()).dataset.custom = '';
    if (fields.every(field => !field.required)) iconButton(monthOnly ? 'No month' : range ? 'Clear range' : 'No date', 'none', () => apply(true)).dataset.none = '';
    const actions = document.createElement('div'); actions.className = 'wi-calendar-actions';
    const applyButton = makeButton(range ? 'Apply range' : 'Apply date', () => apply()); applyButton.dataset.apply = '';
    actions.append(makeButton('Cancel', () => closePicker()), applyButton);
    panel.append(nav, jump, weekdays, grid, editors, shortcuts, error);
    if (!instant) panel.append(actions);
    // Staging edits must not trigger enclosing filter/forms until Apply.
    panel.addEventListener('input', event => event.stopPropagation());
    panel.addEventListener('change', event => event.stopPropagation());
    (input.closest('dialog[open],.modal,.sch-modal') || document.body).append(panel);
    document.documentElement.classList.add('wi-has-calendar');
    panel.dataset.open = ''; if (typeof panel.showPopover === 'function') panel.showPopover();
    control.trigger.setAttribute('aria-expanded', 'true');
    draw(); positionPicker(); grid.querySelector('[tabindex="0"]')?.focus({ preventScroll: true });
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePicker(); return; }
      if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
        event.preventDefault(); event.stopPropagation();
        if (event.target === yearInput) yearInput.onchange(); else apply();
        return;
      }
      if (event.key === 'Tab') {
        const all = focusable(panel), first = all[0], last = all.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      const current = event.target.dataset.date; if (!current) return;
      if (monthOnly && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) {
        event.preventDefault();event.stopPropagation();const date = asDate(current), month = date.getUTCMonth();
        const delta = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-3,ArrowDown:3,Home:-month,End:11-month}[event.key]; date.setUTCMonth(month + delta); const value=isoDate(date);
        if (date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999 && dateAllowed(value)) {state.year=date.getUTCFullYear();draw(value);} return;
      }
      const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -((asDate(current).getUTCDay() + 6) % 7), End: 6 - ((asDate(current).getUTCDay() + 6) % 7) }[event.key];
      if (delta !== undefined) { event.preventDefault(); event.stopPropagation(); const value = addDays(current, delta); if (!dateAllowed(value)) return; const d = asDate(value); state.year = d.getUTCFullYear(); state.month = d.getUTCMonth(); draw(value); }
      else if (event.key === 'PageUp' || event.key === 'PageDown') { event.preventDefault(); moveMonth(event.key === 'PageUp' ? -1 : 1); grid.querySelector('[tabindex="0"]')?.focus(); }
    });
  }
  function positionPicker() {
    if (!picker || matchMedia('(max-width:640px)').matches) return;
    const rect = dateControls.get(picker.input).trigger.getBoundingClientRect(), panel = picker.panel;
    const width = panel.getBoundingClientRect().width, height = panel.getBoundingClientRect().height;
    panel.style.left = Math.max(12, Math.min(rect.left, innerWidth - width - 12)) + 'px';
    panel.style.top = (rect.bottom + height + 8 < innerHeight ? rect.bottom + 6 : Math.max(12, rect.top - height - 6)) + 'px';
  }
  document.addEventListener('pointerdown', event => {
    if (!picker) return;
    const rect = picker.panel.getBoundingClientRect();
    const backdrop = event.target === picker.panel && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
    if (backdrop || !picker.panel.contains(event.target) && !dateControls.get(picker.input).wrapper.contains(event.target)) closePicker(false);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || picker?.panel.contains(event.target)) return;
    const modal = topDialog(); if (!modal) return;
    const elements = focusable(modal), first = elements[0], last = elements.at(-1);
    if (!first) { event.preventDefault(); modal.focus(); }
    else if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  }, true);
  document.addEventListener('click', event => {
    const modal = event.target.closest?.(modalSelector);
    if (modal && updateBusy(modal) && event.target.closest('button,a')) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    const context = { modal, generation }; currentAction = context;
    queueMicrotask(() => { if (currentAction === context) currentAction = null; });
  }, true);
  document.addEventListener('submit', event => {
    const modal = event.target.closest(modalSelector); if (!modal) return;
    if (updateBusy(modal)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    const context = { modal, generation }; currentAction = context; busyState(modal).submission = event.target;
    queueMicrotask(() => { if (currentAction === context) currentAction = null; updateBusy(modal); });
  }, true);
  for (const type of ['input','change','keyup']) document.addEventListener(type, event => {
    const context = { modal: event.target.closest?.(modalSelector), generation }; currentAction = context;
    queueMicrotask(() => { if (currentAction === context) currentAction = null; });
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && updateBusy(topDialog())) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  addEventListener('unhandledrejection', event => { if (event.reason?.code === 'UI_PAGE_CHANGED') event.preventDefault(); });
  function viewportChanged() { document.documentElement.style.setProperty('--wi-viewport-height', (window.visualViewport?.height || innerHeight) + 'px'); positionPicker(); }
  addEventListener('resize', viewportChanged); addEventListener('scroll', positionPicker, true); window.visualViewport?.addEventListener('resize', viewportChanged);
  new MutationObserver(records => {
    for (const record of records) if (record.type === 'attributes' && record.target instanceof HTMLInputElement) dateControls.get(record.target)?.sync();
    scheduleScan();
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['open','value','disabled','readonly','required','min','max','type'] });
  new MutationObserver(records => {
    if (picker && records.some(record => record.target.contains(picker.input))) {
      if (!picker.input.getClientRects().length) closePicker(false); else positionPicker();
    }
    if ([...sessions.keys()].some(modal => !isOpen(modal))) scheduleScan();
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class','style','hidden'] });
  window.WalkinUI = { enhanceModal, enhance: scan, feedback, resultIcon, openDatePicker: openPicker, closeDatePicker: closePicker, cleanup, beginRequest, beginAction: modal => beginRequest({ method: 'POST', modal }), captureView: () => { const version = generation; return () => generation === version; }, staleError, isStale, hasPendingActions: () => [...busyStates.keys()].some(updateBusy) };
  window.WalkinUI.startPage = () => { completionContext = null; currentAction = null; };
  viewportChanged(); scan();
})();
