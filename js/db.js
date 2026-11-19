const databaseName = 'novel-chat:' + new URL('../', import.meta.url).pathname;
export async function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('stories', { keyPath: 'id' });
      request.result.createObjectStore('api');
    };
    request.onerror = () => reject(new Error('无法打开本机数据库，请检查浏览器的存储权限。'));
    request.onblocked = () => reject(new Error('请关闭其他打开的 Novel Chat 标签页后重试。'));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
function read(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export const allStories = db => read(db.transaction('stories').objectStore('stories').getAll());
export const readApi = (db, id) => read(db.transaction('api').objectStore('api').get(id));
function write(db, stores, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    let error;
    const abort = reason => { error = reason; tx.abort(); };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(error || new Error('本机保存失败，请检查剩余空间，稍后重试。'));
    try { work(tx, abort); } catch (err) { abort(err); }
  });
}
export const addStories = (db, list) => write(db, ['stories'], tx => {
  for (const story of list) tx.objectStore('stories').add(story);
});
export function changeStory(db, previous, next, api) {
  return write(db, ['stories', 'api'], (tx, abort) => {
    const stories = tx.objectStore('stories');
    const request = stories.get(previous.id);
    request.onsuccess = () => {
      if (request.result?.rev !== previous.rev) {
        abort(new Error('另一标签页已修改这个故事。请刷新后重试。'));
        return;
      }
      if (!next) {
        stories.delete(previous.id);
        tx.objectStore('api').delete(previous.id);
        return;
      }
      next.rev = previous.rev + 1;
      next.updated = new Date().toISOString();
      stories.put(next);
      if (api !== undefined) tx.objectStore('api').put(api, next.id);
    };
  });
}

