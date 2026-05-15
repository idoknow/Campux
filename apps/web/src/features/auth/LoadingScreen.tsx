export function LoadingScreen() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-white">
      <span className="size-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-500" />
      <p className="text-sm font-bold text-slate-500">正在加载 Campux...</p>
    </main>
  );
}
