/**
 * GreenBridge CacheService
 *
 * localStorage はキャッシュ・UI状態のみに使用してください。
 * 業務データ（勤怠・シフト・書類・メッセージ本体）の保存は禁止です。
 *
 * ✅ 許可: language, activeTab, draft, UI state, APIレスポンスキャッシュ
 * ❌ 禁止: attendance本体, shifts本体, documents本体, worker情報, role情報, チャット履歴本体
 */
const CacheService = (() => {
  const PREFIX = 'gb_';

  function _key(k) { return PREFIX + k; }

  function _get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(_key(key));
      if (raw === null) return fallback;
      return JSON.parse(raw) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function _set(key, value) {
    try {
      localStorage.setItem(_key(key), JSON.stringify(value));
    } catch (e) {
      console.warn('[CacheService] write failed:', key, e);
    }
  }

  function _remove(key) {
    try { localStorage.removeItem(_key(key)); } catch {}
  }

  return {
    // ── 基本操作 ──────────────────────────────────────────────────
    get:    (key, fallback = null) => _get(key, fallback),
    set:    (key, value)           => _set(key, value),
    remove: (key)                  => _remove(key),

    // ── Worker スコープ（WID付き） ────────────────────────────────
    wget:    (key, wid)            => _get(`${key}_${wid}`),
    wset:    (key, wid, value)     => _set(`${key}_${wid}`, value),
    wremove: (key, wid)            => _remove(`${key}_${wid}`),

    // ── TTL付きAPIレスポンスキャッシュ ───────────────────────────
    /**
     * @param {string} key
     * @param {*} value
     * @param {number} ttlMs 有効期間（ミリ秒）デフォルト60秒
     */
    cache(key, value, ttlMs = 60000) {
      _set(key, { v: value, exp: Date.now() + ttlMs });
    },
    /**
     * @param {string} key
     * @returns {*|null} 期限切れまたは未存在はnull
     */
    fromCache(key) {
      const c = _get(key);
      if (!c || typeof c.exp !== 'number' || Date.now() > c.exp) {
        _remove(key);
        return null;
      }
      return c.v;
    },
  };
})();
