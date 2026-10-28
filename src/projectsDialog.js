// The projects dialog: save this slope under a name (Save as), and open one you saved, to
// carry on with it or to start a new one from it. The list is projects.js; what a project
// holds and how it's put in place is main.js (host).
//
//   host: { list(), save(name, { replace }) => { ok, exists?, error? }, open(id), remove(id),
//           current() => { name } | null, dirty() => bool (changes a project would lose) }

import { t, num, getLang, onLang } from './i18n.js';
import { fmtLen } from './slopeMode.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createProjectsDialog(host) {
  const $ = (id) => document.getElementById(id);
  const root = $('projects');
  const form = $('pj-save');
  const input = $('pj-name');
  const msg = $('pj-msg');
  const list = $('pj-list');
  const empty = $('pj-empty');
  let mode = 'save';
  let ask = null; // { id, what: 'open' | 'delete' }
  let replace = null; // the name to save over, once confirmed

  const when = (ms) => new Intl.DateTimeFormat(getLang() === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
  const about = (s) =>
    [
      s.length ? fmtLen(s.length) : '',
      s.gates ? t('pj.gates', { n: s.gates }) : '',
      s.tiles ? t('pj.tiles', { n: s.tiles }) : '',
      s.bestTime ? t('pj.best', { t: num(s.bestTime, 2) }) : '',
    ]
      .filter(Boolean)
      .join(' · ');

  function render() {
    $('pj-title').textContent = mode === 'save' ? t('pj.title') : t('pj.openTitle');
    form.hidden = mode !== 'save';
    const items = host.list();
    empty.hidden = items.length > 0;
    empty.textContent = mode === 'save' ? t('pj.empty') : t('pj.emptyOpen');
    const cur = host.current();
    list.innerHTML = items
      .map((p) => {
        const here = cur && cur.id === p.id;
        let actions = `<button type="button" class="btn pj-open" data-act="open" data-id="${p.id}">${t('pj.open')}</button>
          <button type="button" class="icon-btn pj-del" data-act="delete" data-id="${p.id}" aria-label="${esc(t('pj.delete', { name: p.name }))}" title="${esc(t('pj.delete', { name: p.name }))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3"/></svg></button>`;
        let note = `<small>${esc(when(p.savedAt))}${about(p.summary) ? ` · ${esc(about(p.summary))}` : ''}</small>`;
        if (ask && ask.id === p.id) {
          note = `<small class="pj-ask">${esc(ask.what === 'delete' ? t('pj.askDelete') : t('pj.askOpen'))}</small>`;
          actions = `<button type="button" class="${ask.what === 'delete' ? 'btn pj-danger' : 'send pj-yes'}" data-act="yes" data-id="${p.id}">${ask.what === 'delete' ? t('pj.yesDelete') : t('pj.yesOpen')}</button>
            <button type="button" class="btn" data-act="no">${t('pj.no')}</button>`;
        }
        return `<li class="pj-item${here ? ' is-here' : ''}"><div class="pj-info"><b>${esc(p.name)}</b>${here ? `<em>${t('pj.here')}</em>` : ''}${note}</div><div class="pj-acts">${actions}</div></li>`;
      })
      .join('');
  }
  onLang(() => !root.hidden && render());

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) {
      msg.textContent = t('pj.needName');
      msg.dataset.bad = '1';
      input.focus();
      return;
    }
    const r = host.save(name, { replace: replace === name.toLowerCase() });
    if (r.exists) {
      // a project of that name: Save again replaces it
      replace = name.toLowerCase();
      msg.textContent = t('pj.exists', { name });
      msg.dataset.bad = '1';
      return;
    }
    replace = null;
    if (!r.ok) {
      msg.textContent = t('pj.full');
      msg.dataset.bad = '1';
      return;
    }
    close();
  });
  input.addEventListener('input', () => {
    replace = null;
    msg.textContent = '';
  });

  list.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    const act = b.dataset.act;
    if (act === 'no') ask = null;
    else if (act === 'delete') ask = { id, what: 'delete' };
    else if (act === 'open') {
      if (host.dirty() && !(host.current() && host.current().id === id && !host.dirty())) {
        ask = { id, what: 'open' };
      } else {
        close();
        host.open(id);
        return;
      }
    } else if (act === 'yes') {
      if (ask && ask.what === 'delete') {
        host.remove(id);
        ask = null;
      } else {
        ask = null;
        close();
        host.open(id);
        return;
      }
    }
    render();
  });

  $('pj-close').addEventListener('click', () => close());
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });
  window.addEventListener(
    'keydown',
    (e) => {
      if (root.hidden) return;
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        close();
      }
    },
    true
  );

  function close() {
    root.hidden = true;
    ask = null;
  }

  return {
    // mode: 'save' (Save as, and the list) or 'open' (the list, to open one)
    open(m = 'save') {
      mode = m;
      ask = null;
      replace = null;
      msg.textContent = '';
      msg.dataset.bad = '';
      const cur = host.current();
      input.value = cur ? cur.name : '';
      root.hidden = false;
      render();
      if (mode === 'save') {
        input.focus();
        input.select();
      } else list.querySelector('button')?.focus({ preventScroll: true });
    },
    close,
    get isOpen() {
      return !root.hidden;
    },
  };
}
