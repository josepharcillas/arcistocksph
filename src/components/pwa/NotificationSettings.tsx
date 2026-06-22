import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  isPushSupported,
  getPermission,
  isSubscribed,
  subscribeToPush,
  unsubscribeFromPush,
} from '../../lib/push/subscribe';

interface StockPref {
  ticker: string;
  enabled: boolean;
}

export default function NotificationSettings() {
  const [supported, setSupported] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stocks, setStocks] = useState<StockPref[]>([]);
  // Browser-only values are read after mount so the first client render matches
  // the server render (avoids a hydration mismatch). Defaults are SSR-safe.
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');

  useEffect(() => {
    setSupported(isPushSupported());
    setPermission(getPermission());
    isSubscribed().then(setEnabled);
    loadStocks();
  }, []);

  async function loadStocks() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    // Tickers the user holds — these are what a signal alert would fire for.
    const { data: holdings } = await supabase.from('holdings').select('ticker').eq('user_id', user.id);
    const tickers = [...new Set((holdings ?? []).map((h: any) => h.ticker))];
    const { data: prefs } = await supabase.from('push_preferences').select('ticker, enabled').eq('user_id', user.id);
    const off = new Set((prefs ?? []).filter((p: any) => p.enabled === false).map((p: any) => p.ticker));
    setStocks(tickers.map((t) => ({ ticker: t, enabled: !off.has(t) })));
  }

  async function toggleMaster() {
    setBusy(true);
    setError(null);
    try {
      if (enabled) { await unsubscribeFromPush(); setEnabled(false); }
      else { await subscribeToPush(); setEnabled(true); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleStock(ticker: string, next: boolean) {
    setStocks((prev) => prev.map((s) => (s.ticker === ticker ? { ...s, enabled: next } : s)));
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('push_preferences').upsert(
      { user_id: user.id, ticker, enabled: next },
      { onConflict: 'user_id,ticker' }
    );
  }

  if (!supported) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-sm text-slate-400">
        Push notifications aren’t supported on this device or browser. Try installing
        the app or using Chrome/Edge on Android or desktop.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-white text-sm font-semibold">Push notifications</p>
            <p className="text-slate-400 text-xs mt-0.5">
              Get alerted when a signal changes for a stock you hold.
            </p>
          </div>
          <button
            onClick={toggleMaster}
            disabled={busy || permission === 'denied'}
            className={`text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50 ${
              enabled
                ? 'bg-slate-800 text-white hover:bg-slate-700'
                : 'bg-green-500 text-slate-950 hover:bg-green-400'
            }`}
          >
            {busy ? '…' : enabled ? 'Turn off' : 'Turn on'}
          </button>
        </div>
        {permission === 'denied' && (
          <p className="text-amber-400 text-xs mt-3">
            Notifications are blocked in your browser settings. Re-enable them for this
            site, then turn this on.
          </p>
        )}
        {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <p className="text-white text-sm font-semibold mb-1">Per-stock alerts</p>
        <p className="text-slate-400 text-xs mb-3">Toggle alerts for individual holdings.</p>
        {stocks.length === 0 ? (
          <p className="text-slate-500 text-xs">You don’t hold any stocks yet.</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {stocks.map((s) => (
              <li key={s.ticker} className="flex items-center justify-between py-2.5">
                <span className="text-sm text-white font-medium">{s.ticker}</span>
                <button
                  onClick={() => toggleStock(s.ticker, !s.enabled)}
                  className={`text-xs px-3 py-1 rounded-full transition-colors ${
                    s.enabled ? 'bg-green-500/15 text-green-400' : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {s.enabled ? 'On' : 'Off'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
