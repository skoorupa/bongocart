// =====================================================================
// ui/settingsForm.js — formularz generowany z SETTINGS_SCHEMA.
// Nowe ustawienie w schemacie = nowa kontrolka, bez zmian tutaj.
// Formularz NIE zmienia stanu sam: zgłasza onChange(key, value), a
// właściciel ustawień (host) waliduje i odsyła wynik przez setValues().
// =====================================================================

const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  children.forEach((c) => node.append(c));
  return node;
};

// Każdy typ: build(entry, emit) -> { root, set(value), inputs[] }
const CONTROLS = {
  int(entry, emit) {
    const out = el('output');
    const input = el('input', { type: 'range', min: entry.min, max: entry.max, step: entry.step ?? 1 });
    input.addEventListener('input', () => { out.value = input.value; });
    input.addEventListener('change', () => emit(Number(input.value)));
    return {
      root: el('div', { className: 'ctl-int' }, [input, out]),
      set(v) { input.value = v; out.value = v; },
      inputs: [input],
    };
  },
  select(entry, emit) {
    const input = el('select', {}, entry.options.map((o) => el('option', { value: o.value, textContent: o.label })));
    input.addEventListener('change', () => emit(input.value));
    return { root: input, set(v) { input.value = v; }, inputs: [input] };
  },
  bool(entry, emit) {
    const input = el('input', { type: 'checkbox' });
    input.addEventListener('change', () => emit(input.checked));
    return { root: input, set(v) { input.checked = v; }, inputs: [input] };
  },
  multiselect(entry, emit) {
    const boxes = entry.options.map((o) => ({ value: o.value, input: el('input', { type: 'checkbox' }), label: o.label }));
    const read = () => boxes.filter((b) => b.input.checked).map((b) => b.value);
    boxes.forEach((b) => b.input.addEventListener('change', () => emit(read())));
    return {
      root: el('div', { className: 'ctl-multi' }, boxes.map((b) => el('label', {}, [b.input, ` ${b.label}`]))),
      set(v) { boxes.forEach((b) => { b.input.checked = v.includes(b.value); }); },
      inputs: boxes.map((b) => b.input),
    };
  },
  text(entry, emit) {
    const input = el('input', { type: 'text', maxLength: entry.maxLength, placeholder: entry.placeholder ?? '', spellcheck: false });
    input.addEventListener('change', () => emit(input.value.trim()));
    return { root: input, set(v) { input.value = v; }, inputs: [input] };
  },
};

export function createSettingsForm(container, schema, { onChange }) {
  container.replaceChildren();
  const controls = new Map();
  for (const entry of schema) {
    const ctl = CONTROLS[entry.type](entry, (value) => onChange(entry.key, value));
    controls.set(entry.key, ctl);
    container.append(el('div', { className: 'setting' }, [el('span', { className: 'setting-label', textContent: entry.label }), ctl.root]));
  }
  return {
    // Pełny obiekt ustawień (np. odebrany od hosta) -> kontrolki.
    setValues(values) {
      for (const [key, ctl] of controls) if (key in values) ctl.set(values[key]);
    },
    // Tylko do odczytu: dla klientów oraz w trakcie wyścigu.
    setReadOnly(readOnly) {
      for (const ctl of controls.values()) ctl.inputs.forEach((i) => { i.disabled = readOnly; });
    },
  };
}
