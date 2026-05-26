/**
 * GreenBridge Realtime Service
 *
 * Supabase Realtime を使ってDB変更を即時受信する。
 * 全ページで使用可能（管理者・ワーカー両側）。
 *
 * 使い方:
 *   const ch = GBRealtime.subscribeMessages(myUid, (msg) => { ... });
 *   ch.unsubscribe();  // 解除
 */
const GBRealtime = (() => {
  let _client = null;
  const _channels = new Map();

  function _getConfig() {
    // 管理者: window.GB_REALTIME_CONFIG
    // ワーカー: window.SERVER_DATA に supabaseUrl, supabaseAnonKey, accessToken, refreshToken
    return window.GB_REALTIME_CONFIG
        || (window.SERVER_DATA ? {
              supabaseUrl:     window.SERVER_DATA.supabaseUrl,
              supabaseAnonKey: window.SERVER_DATA.supabaseAnonKey,
              accessToken:     window.SERVER_DATA.accessToken,
              refreshToken:    window.SERVER_DATA.refreshToken,
            } : null);
  }

  async function _getClient() {
    if (_client) return _client;
    const cfg = _getConfig();
    if (!cfg || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      console.warn('[Realtime] config missing — Realtime disabled');
      return null;
    }
    if (typeof supabase === 'undefined' || !supabase.createClient) {
      console.warn('[Realtime] @supabase/supabase-js not loaded');
      return null;
    }

    _client = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });

    if (cfg.accessToken) {
      try {
        await _client.auth.setSession({
          access_token: cfg.accessToken,
          refresh_token: cfg.refreshToken || '',
        });
      } catch (e) {
        console.warn('[Realtime] setSession failed:', e.message);
      }
    }
    return _client;
  }

  // ── messages（個別チャット） ────────────────────────────────────
  async function subscribeMessages(myUid, onMessage, onUpdate) {
    const client = await _getClient();
    if (!client) return null;

    const key = `msg-${myUid}`;
    if (_channels.has(key)) _channels.get(key).unsubscribe();

    const ch = client.channel(key)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages',
          filter: `receiver_id=eq.${myUid}` },
        (payload) => { try { onMessage?.(payload.new); } catch (e) { console.warn(e); } })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages',
          filter: `sender_id=eq.${myUid}` },
        (payload) => { try { onUpdate?.(payload.new); } catch (e) { console.warn(e); } })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') console.log('[Realtime] messages subscribed');
      });

    _channels.set(key, ch);
    return ch;
  }

  // ── group_messages（グループチャット） ──────────────────────────
  async function subscribeGroupMessages(myUid, groupIds, onMessage) {
    const client = await _getClient();
    if (!client || !groupIds?.length) return null;

    const key = `group-${myUid}`;
    if (_channels.has(key)) _channels.get(key).unsubscribe();

    // 複数グループIDで購読（in フィルタ）
    const filter = `group_id=in.(${groupIds.join(',')})`;

    const ch = client.channel(key)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'group_messages', filter },
        (payload) => {
          try { if (payload.new.sender_id !== myUid) onMessage?.(payload.new); } catch (e) { console.warn(e); }
        })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') console.log('[Realtime] group_messages subscribed');
      });

    _channels.set(key, ch);
    return ch;
  }

  // ── shifts（シフト変更） ────────────────────────────────────────
  async function subscribeShifts(workerId, onChange) {
    const client = await _getClient();
    if (!client) return null;

    const key = `shifts-${workerId || 'all'}`;
    if (_channels.has(key)) _channels.get(key).unsubscribe();

    const filter = workerId ? { filter: `worker_id=eq.${workerId}` } : {};
    const ch = client.channel(key)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'shifts', ...filter },
        (payload) => { try { onChange?.(payload); } catch (e) { console.warn(e); } })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') console.log('[Realtime] shifts subscribed');
      });

    _channels.set(key, ch);
    return ch;
  }

  // ── attendance_records（勤怠） ──────────────────────────────────
  async function subscribeAttendance(onChange) {
    const client = await _getClient();
    if (!client) return null;

    const key = 'attendance';
    if (_channels.has(key)) _channels.get(key).unsubscribe();

    const ch = client.channel(key)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_records' },
        (payload) => { try { onChange?.(payload); } catch (e) { console.warn(e); } })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') console.log('[Realtime] attendance subscribed');
      });

    _channels.set(key, ch);
    return ch;
  }

  // ── notifications（通知） ───────────────────────────────────────
  async function subscribeNotifications(onChange) {
    const client = await _getClient();
    if (!client) return null;

    const key = 'notifications';
    if (_channels.has(key)) _channels.get(key).unsubscribe();

    const ch = client.channel(key)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'notifications' },
        (payload) => { try { onChange?.(payload); } catch (e) { console.warn(e); } })
      .subscribe();

    _channels.set(key, ch);
    return ch;
  }

  // ── shift_requests（シフト申請） ────────────────────────────────
  async function subscribeShiftRequests(onChange) {
    const client = await _getClient();
    if (!client) return null;

    const key = 'shift-requests';
    if (_channels.has(key)) _channels.get(key).unsubscribe();

    const ch = client.channel(key)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'shift_requests' },
        (payload) => { try { onChange?.(payload); } catch (e) { console.warn(e); } })
      .subscribe();

    _channels.set(key, ch);
    return ch;
  }

  // ── daily_reports（日報） ──────────────────────────────────────
  async function subscribeDailyReports(onChange) {
    const client = await _getClient();
    if (!client) return null;

    const key = 'daily-reports';
    if (_channels.has(key)) _channels.get(key).unsubscribe();

    const ch = client.channel(key)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'daily_reports' },
        (payload) => { try { onChange?.(payload); } catch (e) { console.warn(e); } })
      .subscribe();

    _channels.set(key, ch);
    return ch;
  }

  function unsubscribeAll() {
    _channels.forEach(ch => { try { ch.unsubscribe(); } catch {} });
    _channels.clear();
  }

  return {
    subscribeMessages,
    subscribeGroupMessages,
    subscribeShifts,
    subscribeAttendance,
    subscribeShiftRequests,
    subscribeDailyReports,
    subscribeNotifications,
    unsubscribeAll,
  };
})();
