import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { SkeletonCard } from '../ui/Skeleton';

interface WatchItem {
  id: string;
  ticker: string;
  company_name: string | null;
  alert_price_above: number | null;
  alert_price_below: number | null;
}

interface Quote { price: number; change1d: number; name: string }

export default function WatchlistManager() {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(true);
  const [ticker, setTicker] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    const [{ data: rows }, quoteRes] = await Promise.all([
      supabase.from('watchlist').select('*').order('created_at', { ascending: false }),
      fetch('/api/stocks').then((r) => r.json()).catch(() => []),
    ]);
    const map: Record<string, Quote> = {};
    if (Array.isArray(quoteRes)) for (const q of quoteRes) map[q.symbol] = q;
    setQuotes(map);
    setItems(rows ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const sym = ticker.toUpperCase().replace('.PS', '').trim();
    if (!sym) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('You must be signed in.'); return; }

    const { error: err } = await supabase.from('watchlist').insert({
      user_id: user.id,
      ticker: sym,
      company_name: quotes[sym]?.name ?? null,
    });
    if (err) { setError(err.code === '23505' ? `${sym} is already on your watchlist.` : err.message); return; }
    setTicker('');
    load();
  }

  async function remove(id: string) {
    await supabase.from('watchlist').delete().eq('id', id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  async function saveAlert(id: string, field: 'alert_price_above' | 'alert_price_below', value: string) {
    const num = value === '' ? null : parseFloat(value);
    await supabase.from('watchlist').update({ [field]: num }).eq('id', id);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, [field]: num } : i)));
  }

  function alertState(item: WatchItem, price: number | undefined): string | null {
    if (price == null) return null;
    if (item.alert_price_above != null && price >= item.alert_price_above) return 'above target';
    if (item.alert_price_below != null && price <= item.alert_price_below) return 'below target';
    return null;
  }

  if (loading) return <div className="space-y-3">{[1, 2, 3].map((i) => <SkeletonCard key={i} />)}</div>;

  return (
    <div>
      <form onSubmit={add} className="flex gap-2 mb-4">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="Add ticker (e.g. SM)"
          className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500"
        />
        <button type="submit" className="bg-green-500 hover:bg-green-400 text-slate-950 font-semibold text-sm px-4 rounded-lg transition-colors">
          + Watch
        </button>
      </form>
      {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

      {items.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-400 mb-1">Your watchlist is empty.</p>
          <p className="text-slate-500 text-sm">Add a ticker above and set price alerts.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const q = quotes[it.ticker];
            const triggered = alertState(it, q?.price);
            return (
              <div key={it.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <a href={`/stock/${it.ticker}`} className="font-bold text-white hover:text-green-400 transition-colors">{it.ticker}</a>
                      {it.company_name && <span className="text-slate-500 text-xs truncate max-w-[160px]">{it.company_name}</span>}
                      {triggered && <span className="text-[10px] uppercase font-semibold text-yellow-400 bg-yellow-400/10 border border-yellow-400/30 rounded px-1.5 py-0.5">⚠ {triggered}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {q ? (
                      <div className="text-right">
                        <p className="text-white font-medium">₱{q.price.toFixed(2)}</p>
                        <p className={`text-xs ${q.change1d >= 0 ? 'text-green-400' : 'text-red-400'}`}>{q.change1d >= 0 ? '+' : ''}{q.change1d.toFixed(2)}%</p>
                      </div>
                    ) : <span className="text-slate-500 text-sm">—</span>}
                    <button onClick={() => remove(it.id)} className="text-slate-600 hover:text-red-400 transition-colors text-xs">✕</button>
                  </div>
                </div>
                <div className="flex gap-3 mt-3 pt-3 border-t border-slate-800">
                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                    Alert above ₱
                    <input
                      type="number" step="0.01" defaultValue={it.alert_price_above ?? ''}
                      onBlur={(e) => saveAlert(it.id, 'alert_price_above', e.target.value)}
                      className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white focus:outline-none focus:border-green-500"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                    below ₱
                    <input
                      type="number" step="0.01" defaultValue={it.alert_price_below ?? ''}
                      onBlur={(e) => saveAlert(it.id, 'alert_price_below', e.target.value)}
                      className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white focus:outline-none focus:border-green-500"
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
