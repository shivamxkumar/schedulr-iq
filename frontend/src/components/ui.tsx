import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'

type Tone = 'primary' | 'accent' | 'ghost' | 'danger' | 'outline'

export function Button({ tone = 'outline', size = 'md', className = '', children, loading, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; size?: 'sm' | 'md'; loading?: boolean }) {
  const tones: Record<Tone, string> = {
    primary: 'bg-navy text-ivory hover:bg-navy-700 border border-navy',
    accent: 'bg-lime text-navy hover:bg-lime-600 border border-navy/80 font-semibold',
    ghost: 'text-navy hover:bg-navy/5 border border-transparent',
    danger: 'text-conflict border border-conflict/40 hover:bg-conflict-50',
    outline: 'bg-white text-navy border border-slate-200 hover:border-navy/40',
  }
  const sizes = { sm: 'h-7 px-2.5 text-xs gap-1.5', md: 'h-9 px-3.5 text-sm gap-2' }
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`inline-flex items-center justify-center whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${tones[tone]} ${sizes[size]} ${className}`}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  )
}

export const Mono = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <span className={`font-mono tabular-nums ${className}`}>{children}</span>
)

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`font-mono text-2xs uppercase tracking-[0.14em] text-slate ${className}`}>{children}</div>
}

export function SectionHead({ index, title, aside, sub }: { index?: string; title: string; aside?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 border-b border-navy/15 pb-2 mb-4">
      <div>
        <div className="flex items-baseline gap-3">
          {index && <Mono className="text-xs text-slate">{index}</Mono>}
          <h2 className="font-display text-lg font-semibold tracking-tight text-navy">{title}</h2>
        </div>
        {sub && <p className="mt-0.5 text-xs text-slate">{sub}</p>}
      </div>
      {aside}
    </div>
  )
}

export function Chip({ children, tone = 'default', className = '' }: { children: ReactNode; tone?: 'default' | 'lime' | 'red' | 'navy' | 'muted'; className?: string }) {
  const t = {
    default: 'border-slate-200 bg-white text-navy',
    lime: 'border-navy/70 bg-lime text-navy',
    red: 'border-conflict/50 bg-conflict-50 text-conflict',
    navy: 'border-navy bg-navy text-ivory',
    muted: 'border-transparent bg-ivory-200 text-slate-600',
  }[tone]
  return <span className={`inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-2xs uppercase tracking-wider ${t} ${className}`}>{children}</span>
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  )
}

export function Empty({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center border border-dashed border-slate-300 px-6 py-12 text-center">
      {icon}
      <div className="mt-2 font-display text-base font-semibold text-navy">{title}</div>
      {body && <div className="mt-1 max-w-md text-sm text-slate">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorBox({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border border-conflict/40 bg-conflict-50 px-4 py-3 text-sm text-navy">
      <div className="flex items-center gap-2 font-semibold text-conflict"><AlertTriangle className="h-4 w-4" />{title}</div>
      {children && <div className="mt-1.5 text-navy/80">{children}</div>}
    </div>
  )
}

export const KIND_LABEL: Record<string, string> = {
  baseline: 'Baseline', optimized: 'Optimized', manual: 'Manual', draft: 'Draft · invalid', diagnostic: 'Diagnostic', partial: 'Partial',
}

export function KindBadge({ kind }: { kind: string }) {
  const tone = kind === 'optimized' ? 'lime' : kind === 'draft' || kind === 'diagnostic' || kind === 'partial' ? 'red' : 'muted'
  return <Chip tone={tone as any}>{KIND_LABEL[kind] || kind}</Chip>
}

export function Bar({ value, max = 1, tone = 'navy', className = '' }: { value: number; max?: number; tone?: 'navy' | 'lime' | 'red' | 'slate'; className?: string }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100))
  const c = { navy: 'bg-navy', lime: 'bg-lime border-r border-navy/60', red: 'bg-conflict', slate: 'bg-slate' }[tone]
  return (
    <div className={`h-1.5 w-full bg-ivory-300 ${className}`}>
      <div className={`h-full ${c} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Select({ value, onChange, children, label, className = '' }: { value: string; onChange: (v: string) => void; children: ReactNode; label: string; className?: string }) {
  return (
    <label className={`flex flex-col gap-0.5 ${className}`}>
      <span className="font-mono text-2xs uppercase tracking-wider text-slate">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`h-8 min-w-0 border bg-white px-2 text-xs text-navy focus:border-navy focus:outline-none ${value ? 'border-navy' : 'border-slate-200'}`}
      >
        {children}
      </select>
    </label>
  )
}
