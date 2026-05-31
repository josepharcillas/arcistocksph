interface SummaryProps {
  totalValue: number;
  totalCost: number;
  holdingsCount: number;
}

export default function PortfolioSummary({ totalValue, totalCost, holdingsCount }: SummaryProps) {
  const pnl = totalValue - totalCost;
  const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
  const isPositive = pnl >= 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <p className="text-slate-400 text-xs mb-1">Total Value</p>
        <p className="text-white text-xl font-bold">₱{totalValue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <p className="text-slate-400 text-xs mb-1">Total P&L</p>
        <p className={`text-xl font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
          {isPositive ? '+' : ''}₱{pnl.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
        </p>
        <p className={`text-xs ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
          {isPositive ? '+' : ''}{pnlPct.toFixed(2)}%
        </p>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 col-span-2 md:col-span-1">
        <p className="text-slate-400 text-xs mb-1">Holdings</p>
        <p className="text-white text-xl font-bold">{holdingsCount}</p>
        <p className="text-slate-500 text-xs">PSE stocks</p>
      </div>
    </div>
  );
}
