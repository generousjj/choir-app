// Per-device storage. Preferences: localStorage. Imported scores and the
// user's corrections: IndexedDB. Every access tolerates storage being
// unavailable (private mode, blocked site data).

export function loadPref<T>(key: string, dflt: T): T {
  try {
    const v = localStorage.getItem('cpp:' + key);
    return v ? { ...dflt, ...JSON.parse(v) } : dflt;
  } catch {
    return dflt;
  }
}
export function savePref(key: string, v: unknown) {
  try {
    localStorage.setItem('cpp:' + key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export interface StoredScore {
  id: string;
  title: string;
  composer: string;
  fileName: string;
  added: number;
  bytes: Uint8Array;
}

/** Corrections for one song + voice line. */
export interface Corrections {
  text: Record<number, string>;
  pron: Record<number, string>;
}

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('choir-practice', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('scores', { keyPath: 'id' });
      r.result.createObjectStore('corrections');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => {
    const req = fn(d.transaction(store, mode).objectStore(store));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function listScores(): Promise<StoredScore[]> {
  try {
    return (await tx<StoredScore[]>('scores', 'readonly', (s) => s.getAll() as IDBRequest<StoredScore[]>)).sort((a, b) => a.added - b.added);
  } catch {
    return [];
  }
}
export const putScore = (s: StoredScore) => tx('scores', 'readwrite', (st) => st.put(s));
export const deleteScore = (id: string) => tx('scores', 'readwrite', (st) => st.delete(id));

export async function getCorrections(key: string): Promise<Corrections> {
  try {
    return ((await tx('corrections', 'readonly', (s) => s.get(key))) as Corrections | undefined) ?? { text: {}, pron: {} };
  } catch {
    return { text: {}, pron: {} };
  }
}
export const putCorrections = (key: string, c: Corrections) => tx('corrections', 'readwrite', (s) => s.put(c, key)).catch(() => undefined);
