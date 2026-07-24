const DEFAULT_TTL_MS = 5 * 60 * 1000;

const store = new Map();

function get(key) {
  const cached = store.get(key);

  if (!cached) {
    return null;
  }

  if (Date.now() > cached.expiresAt) {
    store.delete(key);
    return null;
  }

  return cached.value;
}

function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });

  return value;
}

function del(key) {
  return store.delete(key);
}

function clear() {
  store.clear();
}

module.exports = {
  get,
  set,
  del,
  clear,
  DEFAULT_TTL_MS,
};
