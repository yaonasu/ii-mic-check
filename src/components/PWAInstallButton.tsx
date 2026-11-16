import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Download, Share, PlusSquare, X, CheckCircle2 } from 'lucide-react';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already installed and running standalone
  if (isInstalled) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span>インストール済</span>
      </div>
    );
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 active:scale-95 px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-white shadow-md shadow-cyan-950/40 transition cursor-pointer"
        title="アプリをPCまたはスマートフォンにインストール"
      >
        <Download className="w-4 h-4" />
        <span>アプリをインストール</span>
      </button>
    );
  }

  // iOS Safari flow
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition cursor-pointer"
        >
          <Share className="w-3.5 h-3.5 text-cyan-400" />
          <span>ホーム画面に追加</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in">
            <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl text-slate-100">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-cyan-600 flex items-center justify-center font-bold text-white text-xs">
                    ii
                  </div>
                  <h3 className="font-bold text-base text-white">iPhone / iPad でのインストール</h3>
                </div>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-4 space-y-3 text-xs sm:text-sm text-slate-300">
                <div className="flex items-start gap-3 p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/50">
                  <Share className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-white">1. 共有ボタンをタップ</span>
                    <p className="text-slate-400 text-xs mt-0.5">Safari下部のツールバーにある共有アイコンをタップします。</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/50">
                  <PlusSquare className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-white">2. 「ホーム画面に追加」を選択</span>
                    <p className="text-slate-400 text-xs mt-0.5">メニューをスクロールして「ホーム画面に追加」をタップします。</p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-cyan-600 hover:bg-cyan-500 py-2.5 text-xs sm:text-sm font-semibold text-white transition cursor-pointer"
              >
                閉じる
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // Fallback desktop / browser notice button if prompt is not yet ready or user wants install info
  return (
    <button
      onClick={() => {
        alert('ブラウザのURLバー右端の「インストール」アイコン、またはメニューから「アプリをインストール」が可能です。');
      }}
      className="hidden sm:flex items-center gap-1.5 rounded-lg border border-slate-700/60 bg-slate-800/40 hover:bg-slate-800 px-2.5 py-1 text-xs text-slate-300 transition cursor-pointer"
      title="アプリとしてインストール可能"
    >
      <Download className="w-3.5 h-3.5 text-cyan-400" />
      <span>アプリをインストール</span>
    </button>
  );
};
