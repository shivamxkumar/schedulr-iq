export const CREDIT = 'Made by XYZ IIITians'

/** Team credit shown at the bottom of every screen (hidden when printing). */
export default function Credit({ tone = 'light', className = '' }: { tone?: 'light' | 'dark'; className?: string }) {
  return (
    <footer className={`no-print flex items-center justify-center gap-2 py-4 font-mono text-[11px] uppercase tracking-[0.18em] ${tone === 'dark' ? 'text-ivory/50' : 'text-slate'} ${className}`}>
      <span className="h-1.5 w-1.5 bg-lime ring-1 ring-navy/40" />
      {CREDIT}
    </footer>
  )
}
