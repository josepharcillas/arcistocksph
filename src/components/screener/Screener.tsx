import { useState, useEffect, useMemo } from 'react';
import { SECTORS, SECTOR_BY_TICKER } from '../../data/psei30';
import { Skeleton } from '../ui/Skeleton';

interface Quote {
  symbol: string;
  name: string;
  price: number;
  change1d: number;
  volume: number;
}

type SortKey = 'symbol' | 'price' | 'change1d' | 'volume';

export default function Screener() {
  const [stocks, setStocks] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [sector, setSector] = useState('All');
  const [maxPrice, setMaxPrice] = useState('');
  const [sort, setSort] = useState<SortKey>('volume');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    fetch('/api/stocks')
      .then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); setStocks(d); })
      .catch((e) => setError(e.message || 'Could not load stocks'))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => {
    const q = search.trim().toUpperCase();
    const cap = parseFloat(maxPrice);
    let r = stocks.filter((s) => {
      if (q && !s.symbol.toUpperCase().includes(q) && !s.name?.toUpperCase().includes(q)) return false;
      if (sector !== 'All' && SECTOR_BY_TICKER[s.symbol] !== sector) return false;
      if (!isNaN(cap) && s.price > cap) return false;
      return true;
    });
    r = [...r].sort((a, b) => {
      const av = a[sort], bv = b[sort];
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return dir === 'asc' ? cmp : -cmp;
    });
    return r;
  }, [stocks, search, sector, maxPrice, sort, dir]);

  function toggleSort(key: SortKey) {
    if (sort === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSort(key); setDir('desc'); }
  }

  const arrow = (key: SortKey) => (sort === key ? (dir === 'asc' ? ' ↑' : ' ↓') : '');

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ticker or name…"
          className="flex-1 min-w-[160px] bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500"
        />
        <select
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500"
        >
          <option value="All">All sectors (PSEi 30)</option>
          {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          placeholder="Max ₱"
          type="number"
          min="0"
          className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500"
        />
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : error ? (
        <div className="bg-red-400/10 border border-red-400/30 rounded-xl p-4 text-red-300 text-sm">{error}</div>
      ) : (
        <>
          <p className="text-slate-500 text-xs mb-2">{rows.length} stocks</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-xs border-b border-slate-800">
                  <th className="text-left py-2 cursor-pointer hover:text-white" onClick={() => toggleSort('symbol')}>Ticker{arrow('symbol')}</th>
                  <th className="text-left py-2 hidden sm:table-cell">Name</th>
                  <th className="text-right py-2 cursor-pointer hover:text-white" onClick={() => toggleSort('price')}>Price{arrow('price')}</th>
                  <th className="text-right py-2 cursor-pointer hover:text-white" onClick={() => toggleSort('change1d')}>1d %{arrow('change1d')}</th>
                  <th className="text-right py-2 cursor-pointer hover:text-white hidden sm:table-cell" onClick={() => toggleSort('volume')}>Volume{arrow('volume')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.symbol} className="border-b border-slate-900 hover:bg-slate-900/60">
                    <td className="py-2.5">
                      <a href={`/stock/${s.symbol}`} className="font-semibold text-white hover:text-green-400 transition-colors">{s.symbol}</a>
                    </td>
                    <td className="py-2.5 text-slate-400 hidden sm:table-cell truncate max-w-[220px]">{s.name}</td>
                    <td className="py-2.5 text-right text-white">₱{s.price.toFixed(2)}</td>
                    <td className={`py-2.5 text-right ${s.change1d >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {s.change1d >= 0 ? '+' : ''}{s.change1d.toFixed(2)}%
                    </td>
                    <td className="py-2.5 text-right text-slate-500 hidden sm:table-cell">{s.volume.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
