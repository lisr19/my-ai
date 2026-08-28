/**
 * IndexedDB 封装
 * stores:
 *   libraries: { id, name, createdAt }
 *   words:     { id(auto), libId, unit, word, phonetic, pos, meaning,
 *                example, exampleTrans, status('new'|'mastered'|'wrong'),
 *                wrongCount, lastReviewAt }
 */
(function () {
  const DB_NAME = 'vocab-review-db';
  const DB_VERSION = 2;
  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('libraries')) {
          d.createObjectStore('libraries', { keyPath: 'id' });
        }
        // v2：words 表改用显式字符串主键（旧版 autoIncrement 在部分浏览器
        // 重新打开页面后计数器归零，导致 add 主键冲突、数据写入静默失败）
        if (d.objectStoreNames.contains('words')) {
          d.deleteObjectStore('words');
        }
        const s = d.createObjectStore('words', { keyPath: 'id' });
        s.createIndex('libId', 'libId', { unique: false });
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }

  function reqPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function objectStore(name, mode) {
    return db.transaction(name, mode).objectStore(name);
  }

  function deleteWordsByLib(libId) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('words', 'readwrite');
      const idx = tx.objectStore('words').index('libId');
      const cReq = idx.openCursor(IDBKeyRange.only(libId));
      cReq.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) { cur.delete(); cur.continue(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  let idSeq = 0;
  function genId() {
    return 'w_' + Date.now().toString(36) + '_' + (idSeq++).toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // Vue 3 的 reactive Proxy 无法被 IndexedDB 结构化克隆，写入前转为纯对象
  function plain(v) {
    return JSON.parse(JSON.stringify(v));
  }

  window.VocabDB = {
    async init() { return openDB(); },
    genId,

    async getAllLibraries() {
      return reqPromise(objectStore('libraries', 'readonly').getAll());
    },

    async putLibrary(lib) {
      return reqPromise(objectStore('libraries', 'readwrite').put(plain(lib)));
    },

    async deleteLibrary(id) {
      await deleteWordsByLib(id);
      return reqPromise(objectStore('libraries', 'readwrite').delete(id));
    },

    async getWords(libId) {
      return reqPromise(
        objectStore('words', 'readonly').index('libId').getAll(IDBKeyRange.only(libId))
      );
    },

    async addWords(words) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('words', 'readwrite');
        const s = tx.objectStore('words');
        words.forEach((w) => s.add(plain(w)));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },

    async clearWordsByLib(libId) {
      return deleteWordsByLib(libId);
    },

    async putWord(word) {
      return reqPromise(objectStore('words', 'readwrite').put(plain(word)));
    },

    async putWords(words) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('words', 'readwrite');
        const s = tx.objectStore('words');
        words.forEach((w) => s.put(plain(w)));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },

    async exportAll() {
      const libraries = await reqPromise(objectStore('libraries', 'readonly').getAll());
      const words = await reqPromise(objectStore('words', 'readonly').getAll());
      return {
        app: '复习单元词汇',
        version: 1,
        exportedAt: new Date().toISOString(),
        libraries,
        words,
      };
    },

    async clearAll() {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['libraries', 'words'], 'readwrite');
        tx.objectStore('libraries').clear();
        tx.objectStore('words').clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },

    /** 覆盖式导入备份 */
    async importData(data) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['libraries', 'words'], 'readwrite');
        tx.objectStore('libraries').clear();
        tx.objectStore('words').clear();
        const ls = tx.objectStore('libraries');
        const ws = tx.objectStore('words');
        (data.libraries || []).forEach((l) => ls.put(l));
        (data.words || []).forEach((w) => ws.put(w));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
})();
