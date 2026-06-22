import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { SkeletonCard } from '../ui/Skeleton';
import PortfolioSummary from './PortfolioSummary';
import AddHoldingForm from './AddHoldingForm';

interface Holding {
  id: string;
  ticker: string;
  company_name: string | null;
  qty: number;
  buy_price: number;
  buy_date: string;
}

interface HoldingWithPrice extends Holding {
  currentPrice: number | null;
  dayChange: number | null;
  pnl: number | null;
  pnlPct: number | null;
}

export default function HoldingsList() {
  const [holdings, setHoldings] = useState<HoldingWithPrice[]>([]);
  const [cash, setCash] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setUserId(user.id);
      const { data: c } = await supabase.from('portfolio_cash').select('cash').eq('user_id', user.id).maybeSingle();
      setCash(c ? Number(c.cash) : 0);
    }

    const { data, error: err } = await supabase.from('holdings').select('*').order('created_at', { ascending: false });
    if (err) { setError('Could not load your holdings. Please refresh.'); setLoading(false); return; }
    if (!data) { setLoading(false); return; }

    // Fetch current prices for each holding
    const enriched = await Promise.all(data.map(async (h: Holding) => {
      try {
        const res = await fetch(`/api/stock/${h.ticker}`);
        const stock = await res.json();
        const currentPrice = stock.technicals?.currentPrice ?? null;
        const dayChange = stock.technicals?.priceChange1d ?? null;
        const cost = h.buy_price * h.qty;
        const value = currentPrice ? currentPrice * h.qty : null;
        return {
          ...h,
          currentPrice,
          dayChange,
          pnl: value !== null ? value - cost : null,
          pnlPct: value !== null && cost > 0 ? ((value - cost) / cost) * 100 : null,
        };
      } catch {
        return { ...h, currentPrice: null, dayChange: null, pnl: null, pnlPct: null };
      }
    }));

    setHoldings(enriched);
    setLoading(false);
  }

  async function saveCash(next: number) {
    setCash(next);
    if (!userId) return;
    await supabase.from('portfolio_cash').upsert(
      { user_id: userId, cash: next, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  }

  useEffect(() => { load(); }, []);

  async function deleteHolding(id: string) {
    await supabase.from('holdings').delete().eq('id', id);
    setHoldings(prev => prev.filter(h => h.id !== id));
  }

  const totalCost = holdings.reduce((s, h) => s + h.buy_price * h.qty, 0);
  const totalValue = holdings.reduce((s, h) => s + (h.currentPrice ?? h.buy_price) * h.qty, 0);

  if (loading) return (
    <div className="space-y-3">
      {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
    </div>
  );

  return (
    <div>
      {error && (
        <div className="bg-red-400/10 border border-red-400/30 rounded-xl p-3 mb-4 text-red-300 text-sm">{error}</div>
      )}
      <PortfolioSummary totalValue={totalValue} totalCost={totalCost} holdingsCount={holdings.length} cash={cash} onSetCash={saveCash} />

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Holdings</h2>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="bg-green-500 hover:bg-green-400 text-slate-950 font-semibold text-sm px-3 py-1.5 rounded-lg transition-colors"
        >
          + Add Stock
        </button>
      </div>

      {showAdd && <AddHoldingForm onAdded={() => { setShowAdd(false); load(); }} />}

      {holdings.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-400 mb-2">No holdings yet.</p>
          <p className="text-slate-500 text-sm">Add your first PSE stock to start tracking.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {holdings.map(h => {
            const marketValue = h.currentPrice !== null ? h.currentPrice * h.qty : null;
            const weight = marketValue !== null && totalValue > 0 ? (marketValue / totalValue) * 100 : null;
            return (
            <div key={h.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <a href={`/stock/${h.ticker}`} className="font-bold text-white hover:text-green-400 transition-colors">
                    {h.ticker}
                  </a>
                  {h.dayChange !== null && (
                    <span className={`text-[11px] ${h.dayChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {h.dayChange >= 0 ? '+' : ''}{h.dayChange.toFixed(2)}% today
                    </span>
                  )}
                </div>
                <div className="text-slate-400 text-xs mt-0.5">
                  {h.qty} sh · avg ₱{h.buy_price.toFixed(2)}
                  {h.currentPrice !== null && <> · now ₱{h.currentPrice.toFixed(2)}</>}
                  {weight !== null && <> · {weight.toFixed(1)}% of book</>}
                </div>
              </div>

              <div className="text-right mr-4">
                {marketValue !== null ? (
                  <>
                    <p className="text-white font-medium">₱{marketValue.toLocaleString('en-PH', { maximumFractionDigits: 0 })}</p>
                    <p className={`text-xs ${(h.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {(h.pnl ?? 0) >= 0 ? '+' : ''}₱{(h.pnl ?? 0).toLocaleString('en-PH', { maximumFractionDigits: 0 })} ({(h.pnlPct ?? 0) >= 0 ? '+' : ''}{(h.pnlPct ?? 0).toFixed(2)}%)
                    </p>
                  </>
                ) : (
                  <p className="text-slate-500 text-sm">—</p>
                )}
              </div>

              <button
                onClick={() => deleteHolding(h.id)}
                className="text-slate-600 hover:text-red-400 transition-colors text-xs"
              >
                ✕
              </button>
            </div>
          );})}
        </div>
      )}
    </div>
  );
}
