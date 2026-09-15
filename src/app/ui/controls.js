/**
 * A tiny declarative control factory.
 *
 * Controls are described as data and bound to a dotted path in the config, so
 * adding a new setting is one line here rather than a slider, a label, a
 * listener and a getter. Everything reports through one onChange callback,
 * which the app turns into an engine patch.
 */

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Build the minimal nested patch object for a dotted path. */
export function patchFor(path, value) {
  const keys = path.split('.');
  const out = {};
  let cursor = out;
  for (let i = 0; i < keys.length - 1; i++) cursor = cursor[keys[i]] = {};
  cursor[keys[keys.length - 1]] = value;
  return out;
}

const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
};

export { el };

export class ControlBuilder {
  /**
   * @param {() => object} getConfig
   * @param {(patch: object, meta: object) => void} onChange
   */
  constructor(getConfig, onChange) {
    this.getConfig = getConfig;
    this.onChange = onChange;
    this.bindings = [];   // for refresh() after a preset changes many values
  }

  emit(path, value, meta = {}) {
    this.onChange(patchFor(path, value), { path, value, ...meta });
  }

  /** Re-read every bound control from the config. Call after applying a preset. */
  refresh() {
    const cfg = this.getConfig();
    for (const b of this.bindings) {
      try { b(cfg); } catch { /* a control whose section was rebuilt */ }
    }
  }

  // ── primitives ────────────────────────────────────────────────────────────

  slider(path, { label, min = 0, max = 1, step = 0.01, format, hint, unit = '', live = true } = {}) {
    const cfg = this.getConfig();
    const value = Number(getPath(cfg, path) ?? min);
    const fmt = format || ((v) => (step >= 1 ? String(Math.round(v)) : v.toFixed(step >= 0.1 ? 2 : 3)));

    const out = el('span', { class: 'value', text: fmt(value) + unit });
    const input = el('input', { type: 'range', min, max, step, value });
    const number = el('input', { type: 'number', min, max, step, value, style: 'width:70px' });

    const apply = (v, commit) => {
      v = Math.min(max, Math.max(min, Number(v)));
      out.textContent = fmt(v) + unit;
      input.value = v; number.value = v;
      this.emit(path, v, { commit });
    };
    input.addEventListener('input', () => apply(input.value, !live));
    input.addEventListener('change', () => apply(input.value, true));
    number.addEventListener('change', () => apply(number.value, true));

    this.bindings.push((c) => {
      const v = Number(getPath(c, path) ?? min);
      input.value = v; number.value = v; out.textContent = fmt(v) + unit;
    });

    return el('div', { class: 'ctrl' }, [
      el('label', {}, [el('span', { text: label }), out]),
      el('div', { class: 'row' }, [input, number]),
      hint ? el('div', { class: 'hint', text: hint }) : null
    ]);
  }

  select(path, { label, options, hint } = {}) {
    const cfg = this.getConfig();
    const current = getPath(cfg, path);
    const sel = el('select', {});
    const groups = new Map();
    for (const o of options) {
      const opt = el('option', { value: o.value, text: o.label });
      if (o.value === current) opt.selected = true;
      if (o.group) {
        if (!groups.has(o.group)) {
          const g = el('optgroup', { label: o.group });
          groups.set(o.group, g); sel.append(g);
        }
        groups.get(o.group).append(opt);
      } else sel.append(opt);
    }
    const hintEl = hint ? el('div', { class: 'hint', text: hint }) : null;
    sel.addEventListener('change', () => this.emit(path, sel.value, { commit: true }));
    this.bindings.push((c) => { sel.value = getPath(c, path); });

    return el('div', { class: 'ctrl' }, [
      label ? el('label', {}, [el('span', { text: label })]) : null, sel, hintEl
    ]);
  }

  toggle(path, { label, hint, onToggle } = {}) {
    const cfg = this.getConfig();
    const input = el('input', { type: 'checkbox' });
    input.checked = Boolean(getPath(cfg, path));
    input.addEventListener('change', () => {
      this.emit(path, input.checked, { commit: true, structural: true });
      onToggle?.(input.checked);
    });
    this.bindings.push((c) => { input.checked = Boolean(getPath(c, path)); });

    return el('div', { class: 'ctrl' }, [
      el('label', { class: 'switch' }, [input, el('span', { class: 'track' }), el('span', { text: label })]),
      hint ? el('div', { class: 'hint', text: hint }) : null
    ]);
  }

  color(path, { label, hint, allowNull = false } = {}) {
    const cfg = this.getConfig();
    const raw = getPath(cfg, path);
    const input = el('input', { type: 'color', value: raw || '#ffffff' });
    input.addEventListener('input', () => this.emit(path, input.value, { commit: false }));
    input.addEventListener('change', () => this.emit(path, input.value, { commit: true }));
    this.bindings.push((c) => { input.value = getPath(c, path) || '#ffffff'; });

    const children = [el('label', {}, [el('span', { text: label })])];
    if (allowNull) {
      const off = el('button', { class: 'btn sm ghost', text: raw ? 'Clear' : 'Off', title: 'Disable this colour' });
      off.addEventListener('click', () => this.emit(path, null, { commit: true }));
      children.push(el('div', { class: 'row' }, [input, off]));
    } else {
      children.push(input);
    }
    if (hint) children.push(el('div', { class: 'hint', text: hint }));
    return el('div', { class: 'ctrl' }, children);
  }

  text(path, { label, placeholder, hint } = {}) {
    const cfg = this.getConfig();
    const input = el('input', { type: 'text', value: getPath(cfg, path) ?? '', placeholder: placeholder || '' });
    input.addEventListener('change', () => this.emit(path, input.value, { commit: true }));
    this.bindings.push((c) => { input.value = getPath(c, path) ?? ''; });
    return el('div', { class: 'ctrl' }, [
      el('label', {}, [el('span', { text: label })]), input,
      hint ? el('div', { class: 'hint', text: hint }) : null
    ]);
  }

  vector(basePath, { label, keys = ['x', 'y', 'z'], min = -180, max = 180, step = 1, unit = '' } = {}) {
    const cfg = this.getConfig();
    const inputs = keys.map((k) => {
      const input = el('input', {
        type: 'number', min, max, step,
        value: getPath(cfg, `${basePath}.${k}`) ?? 0, title: k.toUpperCase()
      });
      input.addEventListener('change', () =>
        this.emit(`${basePath}.${k}`, Number(input.value), { commit: true }));
      this.bindings.push((c) => { input.value = getPath(c, `${basePath}.${k}`) ?? 0; });
      return input;
    });
    return el('div', { class: 'ctrl' }, [
      el('label', {}, [el('span', { text: label }), el('span', { class: 'value', text: keys.join(' / ').toUpperCase() + unit })]),
      el('div', { class: keys.length === 2 ? 'grid-2' : 'grid-3' }, inputs)
    ]);
  }

  /**
   * Preset chips, grouped. `onPick` receives the key; the caller decides what
   * config to merge, because presets touch many paths at once.
   */
  presets(items, { current, onPick, showNotes = true } = {}) {
    const wrap = el('div', { class: 'ctrl' });
    const noteEl = showNotes ? el('div', { class: 'hint' }) : null;
    const groups = new Map();
    for (const item of items) {
      if (!groups.has(item.group || '')) groups.set(item.group || '', []);
      groups.get(item.group || '').push(item);
    }
    const chips = [];
    for (const [group, list] of groups) {
      const chipRow = el('div', { class: 'chips' });
      for (const item of list) {
        const chip = el('button', { class: 'chip', text: item.label, type: 'button', title: item.note || '' });
        chip.setAttribute('aria-pressed', String(item.key === current));
        chip.addEventListener('click', () => {
          chips.forEach((c) => c.setAttribute('aria-pressed', 'false'));
          chip.setAttribute('aria-pressed', 'true');
          if (noteEl) noteEl.textContent = item.note || '';
          onPick(item.key, item);
        });
        chip.addEventListener('pointerenter', () => { if (noteEl) noteEl.textContent = item.note || ''; });
        chips.push(chip);
        chipRow.append(chip);
      }
      wrap.append(el('div', { class: 'preset-group' }, [
        group ? el('h4', { text: group }) : null, chipRow
      ]));
    }
    if (noteEl) {
      const active = items.find((i) => i.key === current);
      noteEl.textContent = active?.note || '';
      wrap.append(noteEl);
    }
    wrap.__setActive = (key) => {
      chips.forEach((c, i) => c.setAttribute('aria-pressed', String(items[i].key === key)));
      const active = items.find((i) => i.key === key);
      if (noteEl) noteEl.textContent = active?.note || '';
    };
    return wrap;
  }

  button(label, onClick, { variant = '', title = '', disabled = false } = {}) {
    const b = el('button', { class: `btn ${variant}`.trim(), text: label, type: 'button', title, disabled });
    b.addEventListener('click', () => onClick(b));
    return b;
  }

  row(...children) { return el('div', { class: 'row', style: 'margin-bottom:11px' }, children.filter(Boolean)); }

  note(text, kind = '') { return el('div', { class: `notice ${kind}`.trim(), text }); }

  section(title, { open = false } = {}) {
    const body = el('div', { class: 'section-body' });
    const details = el('details', { class: 'section' }, [
      el('summary', { text: title }), body
    ]);
    if (open) details.open = true;
    details.body = body;
    return details;
  }
}
