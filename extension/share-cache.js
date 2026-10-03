(() => {
  'use strict';
  const MAX_IMAGE = 2 * 1024 * 1024, MAX_BYTES = 32 * 1024 * 1024, MAX_ITEMS = 200;
  let database, queue = Promise.resolve(), revision = 0;
  const downloads = new Map();
  const lanes = [Promise.resolve(), Promise.resolve(), Promise.resolve()]; let nextLane = 0;
  function queuedDownload(url, signal) {
    const lane = nextLane++ % lanes.length;
    const task = lanes[lane].then(() => { signal.throwIfAborted(); return download(url, signal); });
    lanes[lane] = task.catch(() => {}); return task;
  }
  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('budol-share-cache', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('items', { keyPath: 'id' });
      request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = null; }; resolve(request.result); };
      request.onerror = () => reject(new Error('Share cache is unavailable.'));
    }).catch(error => { database = null; throw error; });
    return database;
  }
  function transact(callback, mode = 'readwrite') {
    const result = queue.then(async () => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('items', mode), store = tx.objectStore('items');
        const request = store.getAll(); let result;
        request.onsuccess = () => { try { result = callback(request.result, store); } catch { tx.abort(); } };
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(new Error('Share cache storage failed. Free space and try again.'));
      });
    });
    queue = result.catch(() => {}); return result;
  }
  const summaries = rows => rows.sort((a, b) => b.at.localeCompare(a.at)).map(row => ({ id: row.id, product: row.product, capturedAt: row.at, imageBytes: row.image?.size || 0, imageStatus: row.image ? 'Saved locally' : row.imageStatus || 'No saved image' }));
  async function list() {
    return transact(rows => ({ items: summaries(rows), imageBytes: rows.reduce((sum, row) => sum + (row.image?.size || 0), 0), maxBytes: MAX_BYTES, maxItems: MAX_ITEMS }), 'readonly');
  }
  async function get(id) { return transact(rows => rows.find(row => row.id === id) || null, 'readonly'); }
  function imageType(bytes) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if ([137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n)) return 'image/png';
    const head = String.fromCharCode(...bytes.slice(0, 12));
    if (/^GIF8[79]a/.test(head)) return 'image/gif';
    if (head.startsWith('RIFF') && head.slice(8) === 'WEBP') return 'image/webp';
    return null;
  }
  async function download(url, signal) {
    const source = new URL(url);
    if (source.protocol !== 'https:' || source.username || source.password || source.port || !/(^|\.)susercontent\.com$/.test(source.hostname)) throw new Error('Image host is not supported for local storage.');
    const response = await fetch(source.href, { credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
    if (!response.ok || !response.body) throw new Error('Image could not be downloaded.');
    if (Number(response.headers.get('content-length')) > MAX_IMAGE) { await response.body.cancel(); throw new Error('Image exceeds 2 MiB.'); }
    const reader = response.body.getReader(), chunks = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_IMAGE) { await reader.cancel(); throw new Error('Image exceeds 2 MiB.'); } chunks.push(value); }
    const blob = new Blob(chunks), type = imageType(new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
    if (!type) throw new Error('Unsupported image format.');
    return new Blob(chunks, { type });
  }
  async function capture(raw) {
    const product = BudolCatalog.normalizeProduct(raw), id = product.id, at = new Date().toISOString(), token = crypto.randomUUID(), epoch = revision;
    const record = await transact((rows, store) => {
      if (epoch !== revision) return null;
      const old = rows.find(row => row.id === id);
      const image = old?.imageUrl === product.image ? old.image : null;
      const row = { id, product, at, token, image, imageUrl: product.image, imageStatus: product.image ? 'Image not saved' : 'No image captured' };
      store.put(row);
      const others = rows.filter(row => row.id !== id).sort((a, b) => a.at.localeCompare(b.at));
      while (others.length >= MAX_ITEMS) store.delete(others.shift().id);
      return row;
    });
    if (!record || record.image || !product.image) return;
    downloads.get(id)?.abort(); const controller = new AbortController(); downloads.set(id, controller);
    let image = null, imageStatus;
    try { image = await queuedDownload(product.image, controller.signal); imageStatus = 'Saved locally'; }
    catch (error) { imageStatus = error.name === 'AbortError' || error.name === 'TimeoutError' ? 'Image download interrupted' : error.message; }
    finally { if (downloads.get(id) === controller) downloads.delete(id); }
    if (epoch !== revision) return;
    await transact((rows, store) => {
      const row = rows.find(row => row.id === id);
      if (epoch !== revision || !row || row.token !== token) return;
      let used = rows.filter(row => row.id !== id).reduce((sum, row) => sum + (row.image?.size || 0), 0);
      for (const other of rows.filter(row => row.id !== id && row.image).sort((a, b) => a.at.localeCompare(b.at))) {
        if (used + (image?.size || 0) <= MAX_BYTES) break;
        used -= other.image.size; store.put({ ...other, image: null, imageStatus: 'Image evicted to free space' });
      }
      store.put({ ...row, image, imageStatus });
    });
  }
  async function clear(imagesOnly) {
    revision++; for (const controller of downloads.values()) controller.abort(); downloads.clear();
    await transact((rows, store) => { if (!imagesOnly) store.clear(); else for (const row of rows) store.put({ ...row, image: null, imageStatus: 'Image cleared' }); });
    return list();
  }
  globalThis.BudolShareCache = Object.freeze({ capture, list, get, clear, MAX_IMAGE, MAX_BYTES, MAX_ITEMS });
})();
