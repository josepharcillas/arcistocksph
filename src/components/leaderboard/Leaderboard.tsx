import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Skeleton } from '../ui/Skeleton';

interface Row { rank: number; name: string; returnPct: number; totalValue: number }

const PERIODS = [
  { key: 'all', label: 'All-time' },
  { key: 'month', label: '30 days' },
  { key: 'week', label: '7 days' },
] as const;
type Period = (typeof PERIODS)[number]['key'];

export default function Leaderboard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<Period>('all');

  // opt-in state (logged-in users only)
  const [signedIn, setSignedIn] = useState(false);
  const [optIn, setOptIn] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [saved, setSaved] = useState(false);

  async function loadBoard(p: Period = period) {
    setLoading(true);
    setError('');
    const r = await fetch(`/api/leaderboard?period=${p}`).then((x) => x.json()).catch(() => ({ error: 'failed' }));
    if (r.error) setError(r.error); else setRows(r);
    setLoading(false);
  }

  function selectPeriod(p: Period) {
    setPeriod(p);
    loadBoard(p);
  }

  useEffect(() => {
    loadBoard('all');
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      setSignedIn(true);
      const { data: p } = await supabase.from('profiles').select('display_name, leaderboard_opt_in').eq('id', user.id).maybeSingle();
      if (p) { setOptIn(!!p.leaderboard_opt_in); setDisplayName(p.display_name ?? ''); }
    });
  }, []);

  async function saveOptIn(next: boolean) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setOptIn(next);
    await supabase.from('profiles').update({
      leaderboard_opt_in: next,
      display_name: displayName.trim() || null,
    }).eq('id', user.id);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    loadBoard();
  }

  return (
    <div className="space-y-5">
      {signedIn && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Join the leaderboard</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Display name"
              className="flex-1 min-w-[160px] bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500"
            />
            <button
              onClick={() => saveOptIn(!optIn)}
              className={`text-sm font-semibold px-4 py-2 rounded-lg transition-colors ${optIn ? 'bg-slate-700 text-white hover:bg-slate-600' : 'bg-green-500 text-slate-950 hover:bg-green-400'}`}
            >
              {optIn ? 'Leave leaderboard' : 'Show me on leaderboard'}
            </button>
            {saved && <span className="text-green-400 text-xs">saved</span>}
          </div>
          <p className="text-slate-500 text-xs mt-2">Ranked by paper-trading return from the ₱100,000 baseline.</p>
        </div>
      )}

      <div className="flex gap-1.5">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => selectPeriod(p.key)}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
              period === p.key ? 'bg-green-500 text-slate-950' : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : error ? (
        <div className="bg-red-400/10 border border-red-400/30 rounded-xl p-4 text-red-300 text-sm">{error}</div>
      ) : rows.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-400 mb-1">No one's on the leaderboard yet.</p>
          <p className="text-slate-500 text-sm">Opt in above and start paper trading to claim the top spot.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.rank} className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`w-7 text-center font-bold ${r.rank === 1 ? 'text-yellow-400' : r.rank === 2 ? 'text-slate-300' : r.rank === 3 ? 'text-amber-600' : 'text-slate-500'}`}>
                  {r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}
                </span>
                <span className="text-white font-medium">{r.name}</span>
              </div>
              <div className="text-right">
                <p className={`font-bold ${r.returnPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{r.returnPct >= 0 ? '+' : ''}{r.returnPct.toFixed(2)}%</p>
                <p className="text-slate-500 text-xs">₱{r.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
