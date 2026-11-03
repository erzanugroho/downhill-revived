// The disc image's online check in the browser: port/render/disc/src/lib.rs (dhd_disc, finding 098)
// in JS, the game files hash the server takes. Every file of the ISO 9660 file system gives a record
// (its path, a 0, its size as 8 bytes little-endian, its contents' SHA-256); the hash is the SHA-256
// of the records sorted, one after the other. Nothing outside the files counts.
//
// Run as a worker of its own (worker.js's host_service_disc_check_start), so the game keeps running
// while about 2.4 GB are read: it gets the page's File (or the test hook's URL) and posts dhd_disc's
// answer: 1 hashed now, 2 from this browser's cache, -1 the image can't be read, -2 its game files
// can't be the USA disc's. The answer for a File is kept in IndexedDB, as iso-check.txt natively.
// Also importable (filesHash) for node checks.

export const USA_FILES_SHA256 = 'c8c17bcae383daf9f2feadc7f6d7476c43d659ab8d66127a299b01311f2a3476';
export const USA_FILE_COUNT = 2338;
const SECTOR = 2048, MAX_DEPTH = 32, MAX_DIRECTORY = 16 << 20;

class FormatError extends Error {}
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
const sha256 = async b => new Uint8Array(await crypto.subtle.digest('SHA-256', b));

// read(at, n): a promise of n bytes from byte at; fewer is the image's end.
async function readAt(read, sector, n, what) {
  const b = await read(sector * SECTOR, n);
  if (b.length < n) throw new FormatError(`${what} lies past the image's end`);
  return b;
}

// Every file of the image (its primary volume descriptor at sector 16), as lib.rs's entries.
async function entries(read) {
  let pvd;
  try { pvd = await readAt(read, 16, SECTOR, 'the volume descriptor'); } catch (e) {
    if (e instanceof FormatError) throw new FormatError("it isn't a disc image (no ISO 9660 volume in it)"); throw e; }
  const le32 = (b, at) => new DataView(b.buffer, b.byteOffset + at, 4).getUint32(0, true);
  if (pvd[0] !== 1 || String.fromCharCode(...pvd.subarray(1, 6)) !== 'CD001')
    throw new FormatError("it isn't a disc image (no ISO 9660 volume in it)");
  const todo = [[le32(pvd, 158), le32(pvd, 166), '', 0]], seen = new Set(), files = [], utf8 = new TextDecoder();
  while (todo.length) {
    const [sector, size, prefix, depth] = todo.pop();
    if (depth > MAX_DEPTH || size > MAX_DIRECTORY) throw new FormatError(`the directory ${prefix} is damaged`);
    if (seen.has(sector)) continue;  // a directory listed twice: its files count once
    seen.add(sector);
    const data = await readAt(read, sector, size, `the directory /${prefix}`), found = [];
    for (let i = 0; i < data.length;) {
      const n = data[i];
      if (!n) { i = (Math.floor(i / SECTOR) + 1) * SECTOR; continue; }  // padding to the sector's end
      const rec = data.subarray(i, i + n);
      if (n < 34 || rec.length < n || 33 + rec[32] > n) throw new FormatError(`the directory /${prefix} is damaged`);
      i += n;
      const raw = rec.subarray(33, 33 + rec[32]);
      if (raw.length === 1 && raw[0] < 2) continue;  // "." and ".."
      const extent = le32(rec, 2), length = le32(rec, 10), flags = rec[25], name = utf8.decode(raw);
      if (flags & 2) { found.push([extent, length, `${prefix}${name}/`, depth + 1]); continue; }
      if (flags & 0x80) throw new FormatError(`${prefix}${name} is stored in pieces`);
      // FILE.EXT;1 is FILE.EXT; FILE.;1 (no extension) is FILE
      const plain = name.split(';')[0];
      files.push({ path: prefix + (plain.endsWith('.') ? plain.slice(0, -1) : plain), sector: extent, size: length });
    }
    todo.push(...found.reverse());
  }
  return files;
}

function record(path, size, contents) {
  const p = new TextEncoder().encode(path), r = new Uint8Array(p.length + 41);
  r.set(p); new DataView(r.buffer).setBigUint64(p.length + 1, BigInt(size), true); r.set(contents, p.length + 9);
  return r;
}

function compare(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

// The image's game files hash: { sha256 (hex), count }. The files are read in their order on the
// disc, so the image is read once from start to end (the largest USA file is about 105 MB).
export async function filesHash(read) {
  const files = (await entries(read)).sort((a, b) => a.sector - b.sector), records = [];
  for (const f of files) records.push(record(f.path, f.size, await sha256(await readAt(read, f.sector, f.size, f.path))));
  records.sort(compare);
  const all = new Uint8Array(records.reduce((n, r) => n + r.length, 0));
  records.reduce((at, r) => (all.set(r, at), at + r.length), 0);
  return { sha256: hex(await sha256(all)), count: records.length };
}

// What the log says: "" for the USA disc's files.
export function note({ sha256: h, count }) {
  if (h === USA_FILES_SHA256) return '';
  return `its game files aren't the USA disc's${count !== USA_FILE_COUNT ? ` (${count} files, the USA disc has ${USA_FILE_COUNT})` : ''}`;
}

// ---- the cache: one answer per File (name, size, last write), as iso-check.txt's line ----
function cacheStore(mode, use) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('dhd-disc-check', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('files');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result, t = db.transaction('files', mode), r = use(t.objectStore('files'));
      t.oncomplete = () => { db.close(); resolve(r.result); }; t.onerror = () => { db.close(); reject(t.error); }; };
  });
}

async function check({ file, isoUrl }) {
  let read;
  if (file) read = async (at, n) => new Uint8Array(await file.slice(at, at + n).arrayBuffer());
  else read = async (at, n) => {
    const r = await fetch(isoUrl, { headers: { Range: `bytes=${at}-${at + n - 1}` } });
    if (r.status !== 206) throw Error(`disc read ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  };
  const key = file && `${file.name}:${file.size}:${file.lastModified}`;
  // a cache that can't be read or written only costs the hashing
  const cached = key && await cacheStore('readonly', s => s.get(key)).catch(() => undefined);
  if (cached?.sha256?.length === 64) return { answer: 2, ...cached };
  const files = await filesHash(read);
  if (key) await cacheStore('readwrite', s => s.put(files, key)).catch(() => {});
  return { answer: 1, ...files };
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope)
  onmessage = e => check(e.data).then(
    files => postMessage({ answer: files.answer, sha256: files.sha256, note: note(files) }),
    err => postMessage({ answer: err instanceof FormatError ? -2 : -1, note: String(err?.message || err) }));
