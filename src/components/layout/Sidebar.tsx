import { useState } from 'react';

const links = [
  { href: '/dashboard', label: 'Portfolio', icon: '💼' },
  { href: '/dashboard/signals', label: 'Signals', icon: '📡' },
  { href: '/screener', label: 'Screener', icon: '🔍' },
  { href: '/dashboard/watchlist', label: 'Watchlist', icon: '👁' },
  { href: '/dashboard/paper-trading', label: 'Paper Trade', icon: '📄' },
  { href: '/leaderboard', label: 'Leaderboard', icon: '🏆' },
  { href: '/dashboard/notifications', label: 'Notifications', icon: '🔔' },
];

export default function Sidebar({ currentPath }: { currentPath: string }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 min-h-screen bg-slate-900 border-r border-slate-800 p-4 gap-1 fixed left-0 top-0">
        <a href="/" className="mb-6 px-2">
          <span className="text-green-400 font-bold text-lg">ArciStocks</span>
          <span className="text-slate-500 text-xs block">PH Stock Advisor</span>
        </a>
        {links.map(l => (
          <a
            key={l.href}
            href={l.href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              currentPath === l.href
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <span>{l.icon}</span>
            {l.label}
          </a>
        ))}
        <div className="mt-auto">
          <a href="/api/auth/signout" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-500 hover:text-white hover:bg-slate-800 transition-colors">
            <span>🚪</span> Sign out
          </a>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 flex justify-around py-2 z-50">
        {links.slice(0, 5).map(l => (
          <a
            key={l.href}
            href={l.href}
            className={`flex flex-col items-center gap-0.5 px-2 py-1 text-xs transition-colors ${
              currentPath === l.href ? 'text-green-400' : 'text-slate-500'
            }`}
          >
            <span className="text-lg">{l.icon}</span>
            {l.label}
          </a>
        ))}
      </nav>
    </>
  );
}
