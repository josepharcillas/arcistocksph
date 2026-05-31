import type { StockAnalysisResult } from '../../lib/ai/types';

interface Props {
  ticker: string;
  result: StockAnalysisResult;
}

const verdictConfig = {
  BUY:  { color: 'text-green-400', bg: 'bg-green-400/10 border-green-400/30', label: 'BUY' },
  SELL: { color: 'text-red-400',   bg: 'bg-red-400/10 border-red-400/30',   label: 'SELL' },
  HOLD: { color: 'text-yellow-400', bg: 'bg-yellow-400/10 border-yellow-400/30', label: 'HOLD' },
};

const confidenceColor = { HIGH: 'text-green-500', MEDIUM: 'text-yellow-500', LOW: 'text-slate-500' };

export default function SignalCard({ ticker, result }: Props) {
  const v = verdictConfig[result.verdict];
  const ts = new Date(result.analyzedAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`border rounded-xl p-4 ${v.bg}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <a href={`/stock/${ticker}`} className="font-bold text-white text-lg hover:text-green-400 transition-colors">
            {ticker}
          </a>
          <span className={`font-bold text-sm px-2 py-0.5 rounded ${v.color}`}>
            {v.label}
          </span>
          <span className={`text-xs ${confidenceColor[result.confidence]}`}>
            {result.confidence} confidence
          </span>
        </div>
        <span className="text-slate-500 text-xs">{ts}</span>
      </div>

      <p className="text-slate-300 text-sm leading-relaxed">{result.rationale}</p>

      {(result.targetPrice || result.stopLoss) && (
        <div className="flex gap-4 mt-3">
          {result.targetPrice && (
            <div>
              <span className="text-slate-500 text-xs">Target</span>
              <span className="text-green-400 text-sm font-medium ml-1">₱{result.targetPrice.toFixed(2)}</span>
            </div>
          )}
          {result.stopLoss && (
            <div>
              <span className="text-slate-500 text-xs">Stop Loss</span>
              <span className="text-red-400 text-sm font-medium ml-1">₱{result.stopLoss.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      <p className="text-slate-600 text-xs mt-2">via {result.provider}</p>
    </div>
  );
}
