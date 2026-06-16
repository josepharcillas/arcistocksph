import { useState, useEffect } from 'react';

// Shows an "Add to Home Screen" banner when the browser fires
// beforeinstallprompt (Android/Chrome/Edge). iOS Safari doesn't fire it, so the
// banner simply never shows there — that's expected.
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('pwa-install-dismissed')) { setHidden(true); return; }
    const handler = (e: any) => { e.preventDefault(); setDeferred(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!deferred || hidden) return null;

  async function install() {
    deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  }
  function dismiss() {
    localStorage.setItem('pwa-install-dismissed', '1');
    setHidden(true);
  }

  return (
    <div className="fixed bottom-20 md:bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 bg-slate-900 border border-slate-700 rounded-xl p-4 shadow-xl z-50">
      <div className="flex items-start gap-3">
        <span className="text-2xl">📲</span>
        <div className="flex-1">
          <p className="text-white text-sm font-semibold">Install ArciStocks PH</p>
          <p className="text-slate-400 text-xs mt-0.5">Add to your home screen for quick access and alerts.</p>
          <div className="flex gap-2 mt-2">
            <button onClick={install} className="bg-green-500 hover:bg-green-400 text-slate-950 font-semibold text-xs px-3 py-1.5 rounded-lg transition-colors">Install</button>
            <button onClick={dismiss} className="text-slate-500 hover:text-white text-xs px-2 py-1.5 transition-colors">Not now</button>
          </div>
        </div>
      </div>
    </div>
  );
}
