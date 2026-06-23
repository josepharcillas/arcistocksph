import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { SkeletonCard } from '../ui/Skeleton';
import { derivePositions } from '../../lib/paper';

const START_BALANCE = 100000;

interface Trade {
  id: string;
  ticker: string;
  action: 'BUY' | 'SELL';
  qty: number;
  price: number;
  traded_at: string;
}
interface Quote { price: number; change1d: number; name: string }
interface Position { ticker: string; qty: number; avgCost: number }

export default function PaperTrading() {
  const [balance, setBalance] = useState<number>(START_BALANCE);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const [ticker, setTicker] = useState('');
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editBal, setEditBal] = useState(false);
  const [balDraft, setBalDraft] = useState('');

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    setUserId(user.id);

    // ensure a balance row exists (₱100k starting cash)
    let { data: bal } = await supabase.from('paper_balances').select('balance').eq('user_id', user.id).maybeSingle();
    if (!bal) {
      await supabase.from('paper_balances').insert({ user_id: user.id, balance: START_BALANCE });
      bal = { balance: START_BALANCE };
    }
    setBalance(Number(bal.balance));

    const [{ data: tr }, quoteRes] = await Promise.all([
      supabase.from('paper_trades').select('*').order('traded_at', { ascending: false }),
      fetch('/api/stocks').then((r) => r.json()).catch(() => []),
    ]);
    const map: Record<string, Quote> = {};
    if (Array.isArray(quoteRes)) for (const q of quoteRes) map[q.symbol] = q;
    setQuotes(map);
    setTrades(tr ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Derive positions from the trade log (DB gives newest-first; derivePositions
  // wants oldest-first). Math lives in src/lib/paper.ts (unit-tested).
  const positions: Position[] = derivePositions([...trades].reverse());

  const positionsValue = positions.reduce((s, p) => s + p.qty * (quotes[p.ticker]?.price ?? p.avgCost), 0);
  const totalValue = balance + positionsValue;
  const totalReturn = ((totalValue / START_BALANCE) - 1) * 100;

  async function trade(action: 'BUY' | 'SELL') {
    setError(''); setNotice('');
    const sym = ticker.toUpperCase().replace('.PS', '').trim();
    const n = parseFloat(qty);
    if (!sym || !n || n <= 0) { setError('Enter a ticker and a positive quantity.'); return; }
    const price = quotes[sym]?.price;
    if (!price) { setError(`No live price for ${sym}.`); return; }
    if (!userId) { setError('You must be signed in.'); return; }

    const value = n * price;
    if (action === 'BUY' && value > balance) { setError(`Insufficient cash. Need ₱${value.toFixed(2)}, have ₱${balance.toFixed(2)}.`); return; }
    if (action === 'SELL') {
      const held = positions.find((p) => p.ticker === sym)?.qty ?? 0;
      if (n > held) { setError(`You only hold ${held} ${sym}.`); return; }
    }

    setBusy(true);
    const newBalance = action === 'BUY' ? balance - value : balance + value;
    const { error: tErr } = await supabase.from('paper_trades').insert({
      user_id: userId, ticker: sym, company_name: quotes[sym]?.name ?? null, action, qty: n, price,
    });
    if (tErr) { setError(tErr.message); setBusy(false); return; }
    await supabase.from('paper_balances').update({ balance: newBalance, updated_at: new Date().toISOString() }).eq('user_id', userId);

    setBusy(false); setQty(''); setTicker('');
    setNotice(`${action} ${n} ${sym} @ ₱${price.toFixed(2)} — total ₱${value.toFixed(2)}`);
    load();
  }

  async function setPaperBalance(next: number) {
    if (!userId || isNaN(next) || next < 0) return;
    await supabase.from('paper_balances').upsert(
      { user_id: userId, balance: next, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
    setBalance(next);
    setEditBal(false);
  }

  if (loading) return <div className="space-y-3">{[1, 2].map((i) => <SkeletonCard key={i} />)}</div>;

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <p className="text-slate-500 text-xs">Total Value</p>
          <p className="text-white text-lg font-bold">₱{totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <p className="text-slate-500 text-xs">Return</p>
          <p className={`text-lg font-bold ${totalReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>{totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(2)}%</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <p className="text-slate-500 text-xs">Cash</p>
            {!editBal && (
              <button onClick={() => { setBalDraft(String(Math.round(balance))); setEditBal(true); }} className="text-slate-500 hover:text-green-400 text-[11px]">adjust</button>
            )}
          </div>
          {editBal ? (
            <div className="mt-1 space-y-1">
              <div className="flex items-center gap-1">
                <input
                  type="number" min="0" value={balDraft} autoFocus
                  onChange={(e) => setBalDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setPaperBalance(parseFloat(balDraft)); if (e.key === 'Escape') setEditBal(false); }}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-green-500"
                />
                <button onClick={() => setPaperBalance(parseFloat(balDraft))} className="text-green-400 text-xs px-1">✓</button>
              </div>
              <button onClick={() => setPaperBalance(START_BALANCE)} className="text-slate-500 hover:text-white text-[11px]">reset to ₱100k</button>
            </div>
          ) : (
            <p className="text-white text-sm font-medium mt-1">₱{balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          )}
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <p className="text-slate-500 text-xs">Positions</p>
          <p className="text-white text-sm font-medium mt-1">₱{positionsValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
        </div>
      </div>

      {/* Order ticket */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-slate-300 mb-3">Place Order</h2>
        {error && <p className="text-red-400 text-xs mb-2">{error}</p>}
        {notice && <p className="text-green-400 text-xs mb-2">{notice}</p>}
        <div className="flex flex-wrap gap-2">
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="Ticker"
            className="w-28 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500" />
          <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Shares" type="number" min="1"
            className="w-28 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500" />
          {ticker && quotes[ticker.toUpperCase()] && (
            <span className="text-slate-400 text-xs self-center">@ ₱{quotes[ticker.toUpperCase()].price.toFixed(2)}</span>
          )}
          <button disabled={busy} onClick={() => trade('BUY')} className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-slate-950 font-semibold text-sm px-4 rounded-lg transition-colors">Buy</button>
          <button disabled={busy} onClick={() => trade('SELL')} className="bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white font-semibold text-sm px-4 rounded-lg transition-colors">Sell</button>
        </div>
      </div>

      {/* Positions */}
      <div>
        <h2 className="text-sm font-semibold text-slate-300 mb-2">Positions</h2>
        {positions.length === 0 ? (
          <p className="text-slate-500 text-sm bg-slate-900 border border-slate-800 rounded-xl p-4">No open positions. Place your first paper trade above.</p>
        ) : (
          <div className="space-y-2">
            {positions.map((p) => {
              const cur = quotes[p.ticker]?.price ?? p.avgCost;
              const pnl = (cur - p.avgCost) * p.qty;
              const pnlPct = p.avgCost > 0 ? ((cur - p.avgCost) / p.avgCost) * 100 : 0;
              return (
                <div key={p.ticker} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <a href={`/stock/${p.ticker}`} className="font-bold text-white hover:text-green-400">{p.ticker}</a>
                    <p className="text-slate-500 text-xs">{p.qty} sh · avg ₱{p.avgCost.toFixed(2)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white text-sm">₱{cur.toFixed(2)}</p>
                    <p className={`text-xs ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{pnl >= 0 ? '+' : ''}₱{pnl.toFixed(0)} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* History */}
      {trades.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-300 mb-2">Trade History</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-slate-500 text-xs border-b border-slate-800">
                <th className="text-left py-2">Date</th><th className="text-left py-2">Action</th><th className="text-left py-2">Ticker</th>
                <th className="text-right py-2">Qty</th><th className="text-right py-2">Price</th><th className="text-right py-2">Total</th>
              </tr></thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id} className="border-b border-slate-900">
                    <td className="py-2 text-slate-400">{new Date(t.traded_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</td>
                    <td className={`py-2 font-medium ${t.action === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{t.action}</td>
                    <td className="py-2 text-white">{t.ticker}</td>
                    <td className="py-2 text-right text-slate-300">{t.qty}</td>
                    <td className="py-2 text-right text-slate-300">₱{Number(t.price).toFixed(2)}</td>
                    <td className="py-2 text-right text-slate-300">₱{(t.qty * Number(t.price)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
