import { useState } from 'react';

interface SummaryProps {
  totalValue: number;   // market value of holdings
  totalCost: number;    // cost basis of holdings
  holdingsCount: number;
  cash: number;
  onSetCash: (cash: number) => void;
}

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PortfolioSummary({ totalValue, totalCost, holdingsCount, cash, onSetCash }: SummaryProps) {
  const pnl = totalValue - totalCost;
  const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
  const isPositive = pnl >= 0;
  const equity = cash + totalValue;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(cash));

  function save() {
    const v = parseFloat(draft);
    if (!isNaN(v) && v >= 0) onSetCash(v);
    setEditing(false);
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <p className="text-slate-400 text-xs mb-1">Total Account Equity</p>
        <p className="text-white text-xl font-bold">{peso(equity)}</p>
        <p className="text-slate-500 text-xs">cash + holdings</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <p className="text-slate-400 text-xs mb-1">Cash</p>
          {!editing && (
            <button onClick={() => { setDraft(String(cash)); setEditing(true); }} className="text-slate-500 hover:text-green-400 text-xs">edit</button>
          )}
        </div>
        {editing ? (
          <div className="flex items-center gap-1 mt-1">
            <input
              type="number" min="0" value={draft} autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-green-500"
            />
            <button onClick={save} className="text-green-400 text-xs px-1">✓</button>
          </div>
        ) : (
          <p className="text-white text-xl font-bold">{peso(cash)}</p>
        )}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <p className="text-slate-400 text-xs mb-1">Holdings Value</p>
        <p className="text-white text-xl font-bold">{peso(totalValue)}</p>
        <p className="text-slate-500 text-xs">{holdingsCount} stock{holdingsCount === 1 ? '' : 's'}</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <p className="text-slate-400 text-xs mb-1">Holdings P&L</p>
        <p className={`text-xl font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
          {isPositive ? '+' : ''}{peso(pnl)}
        </p>
        <p className={`text-xs ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
          {isPositive ? '+' : ''}{pnlPct.toFixed(2)}%
        </p>
      </div>
    </div>
  );
}
