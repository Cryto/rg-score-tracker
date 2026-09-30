import { searchKey } from './search';

// Site-wide replacement for the browser's <datalist> popup, which can't be
// styled and in Chrome opens narrower than (and offset from) its input.
// Any <input list="..."> on the page gets a suggestion list exactly as wide as
// the input. Pages keep filling the <datalist> as usual: each <option>'s value
// is the suggestion, and its label (if different) is shown underneath.

const MAX_ITEMS = 100;

function attach(input: HTMLInputElement, datalist: HTMLDataListElement) {
  // Drop the native popup (and its ▼ indicator); the datalist stays as the data source.
  input.removeAttribute('list');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');

  const popup = document.createElement('ul');
  popup.className = 'combobox-list';
  popup.id = `${datalist.id}-combobox`;
  popup.setAttribute('role', 'listbox');
  popup.hidden = true;
  input.setAttribute('aria-controls', popup.id);
  document.body.append(popup);

  let items: HTMLLIElement[] = [];
  let active = -1;

  function position() {
    const r = input.getBoundingClientRect();
    popup.style.left = `${r.left + window.scrollX}px`;
    popup.style.top = `${r.bottom + window.scrollY + 2}px`;
    popup.style.width = `${r.width}px`;
  }

  function setActive(i: number) {
    items[active]?.removeAttribute('aria-selected');
    active = i;
    const item = items[active];
    if (item) {
      item.setAttribute('aria-selected', 'true');
      item.scrollIntoView({ block: 'nearest' });
      input.setAttribute('aria-activedescendant', item.id);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function render() {
    const q = searchKey(input.value.trim());
    popup.innerHTML = '';
    items = [];
    active = -1;
    input.removeAttribute('aria-activedescendant');
    for (const opt of datalist.options) {
      const value = opt.value;
      const label = opt.label && opt.label !== value ? opt.label : '';
      if (q && !searchKey(`${value} ${label}`).includes(q)) continue;
      const li = document.createElement('li');
      li.id = `${popup.id}-${items.length}`;
      li.setAttribute('role', 'option');
      li.dataset.value = value;
      const main = document.createElement('span');
      main.textContent = value;
      li.append(main);
      if (label) {
        const sub = document.createElement('small');
        sub.textContent = label;
        li.append(sub);
      }
      popup.append(li);
      items.push(li);
      if (items.length >= MAX_ITEMS) break;
    }
    // Nothing left to suggest once the input holds exactly the one match.
    const exact = items.length === 1 && items[0].dataset.value === input.value;
    return items.length > 0 && !exact;
  }

  function open() {
    if (!render()) return close();
    position();
    popup.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function close() {
    popup.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function pick(li: HTMLLIElement) {
    input.value = li.dataset.value ?? '';
    close();
    // Pages react to picks the same way they did to the native datalist.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  input.addEventListener('focus', open);
  input.addEventListener('click', open);
  input.addEventListener('input', (e) => {
    // Our own pick() dispatches input too; don't reopen on it.
    if (e.isTrusted) open();
  });
  input.addEventListener('blur', close);
  // Capture phase, so a picked suggestion's Enter doesn't also reach the
  // page's own Enter handling (e.g. submitting the form or adding a member).
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (popup.hidden) { open(); if (popup.hidden) return; }
      e.preventDefault();
      if (e.key === 'ArrowUp' && active <= 0) setActive(items.length - 1);
      else setActive((active + (e.key === 'ArrowDown' ? 1 : -1)) % items.length);
    } else if (e.key === 'Enter' && !popup.hidden && items[active]) {
      e.preventDefault();
      e.stopImmediatePropagation();
      pick(items[active]);
    } else if (e.key === 'Escape' && !popup.hidden) {
      e.preventDefault();
      close();
    }
  }, { capture: true });

  // mousedown (not click) with preventDefault keeps focus in the input.
  popup.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const li = (e.target as HTMLElement).closest('li');
    if (li) pick(li as HTMLLIElement);
  });

  // Keep the list attached to the input while the page moves underneath it.
  window.addEventListener('resize', () => { if (!popup.hidden) position(); });
  window.addEventListener('scroll', () => { if (!popup.hidden) position(); }, { capture: true, passive: true });
  // Suggestions often arrive after the page loads (from the database).
  new MutationObserver(() => {
    if (document.activeElement === input) open();
  }).observe(datalist, { childList: true });
}

/** Upgrade every <input list> under root to the styled suggestion list. */
export function initComboboxes(root: ParentNode = document) {
  for (const input of root.querySelectorAll<HTMLInputElement>('input[list]')) {
    const datalist = document.getElementById(input.getAttribute('list')!);
    if (datalist instanceof HTMLDataListElement) attach(input, datalist);
  }
}
