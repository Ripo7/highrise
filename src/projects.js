// Projects: slopes saved under a name (Save as), to open again later or to start from. Each
// keeps everything the autosave keeps (the slope, the tiles, the start, the records): a
// project is a named copy of a save (see main.js). They live in the browser, in one list.

const KEY = 'highrise.projects.v1';
export const MAX_PROJECTS = 60;

const read = (store) => {
  try {
    const a = JSON.parse(store.getItem(KEY) || '[]');
    return Array.isArray(a) ? a.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && p.data) : [];
  } catch {
    return [];
  }
};
const write = (store, list) => store.setItem(KEY, JSON.stringify(list));

export const cleanName = (name) =>
  String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);

/** The projects, the latest saved first: [{ id, name, savedAt, summary }] (no data). */
export function listProjects(store = localStorage) {
  return read(store)
    .map(({ id, name, savedAt, summary }) => ({ id, name, savedAt, summary: summary || {} }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export const findByName = (name, store = localStorage) => listProjects(store).find((p) => p.name.toLowerCase() === cleanName(name).toLowerCase()) || null;

/**
 * Save data under name: a project with that name is replaced (same id), else a new one.
 * summary: a few numbers for the list. Returns { id, name }. Throws when storage is full.
 */
export function saveProject(name, data, summary = {}, store = localStorage, now = Date.now()) {
  const n = cleanName(name);
  if (!n) throw new Error('no name');
  const list = read(store);
  const old = list.find((p) => p.name.toLowerCase() === n.toLowerCase());
  const id = old ? old.id : `p${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const rec = { id, name: n, savedAt: now, summary, data };
  const next = [rec, ...list.filter((p) => p.id !== id)].slice(0, MAX_PROJECTS);
  write(store, next);
  return { id, name: n };
}

export function loadProject(id, store = localStorage) {
  return read(store).find((p) => p.id === id) || null;
}

export function deleteProject(id, store = localStorage) {
  write(
    store,
    read(store).filter((p) => p.id !== id)
  );
}
