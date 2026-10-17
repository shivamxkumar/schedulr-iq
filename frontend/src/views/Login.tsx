import { useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, LogIn, ShieldCheck } from 'lucide-react'
import { api, ApiError, session, type User } from '../api'
import { Button, ErrorBox, Mono } from '../components/ui'

export const INSTITUTE = 'Indian Institute of Information Technology Surat'

export function InstituteMark({ size = 40 }: { size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center bg-white p-[3px]" style={{ width: size, height: size }}>
      <img src="/iiit-surat-logo.png" alt="IIIT Surat logo" className="h-full w-auto object-contain" />
    </span>
  )
}

/** Abstract week grid — a quiet nod to the product, drawn from fixed data. */
function WeekGlyph() {
  const blocks = [[0, 0, 1], [0, 2, 2], [1, 1, 1], [1, 3, 2], [2, 0, 2], [2, 3, 1], [3, 1, 2], [3, 5, 1], [4, 0, 1], [4, 2, 1], [4, 4, 2], [5, 0, 2]]
  return (
    <div className="grid grid-cols-6 gap-[3px]" aria-hidden>
      {Array.from({ length: 6 }, (_, d) => (
        <div key={d} className="relative h-[120px] border-t border-white/15">
          {blocks.filter(b => b[0] === d).map(([, s, dur], i) => (
            <span key={i} className={`absolute inset-x-0 ${d === 2 && s === 3 ? 'bg-lime' : 'bg-white/[0.13]'}`} style={{ top: s * 20 + 2, height: dur * 20 - 4 }} />
          ))}
        </div>
      ))}
    </div>
  )
}

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [demoBusy, setDemoBusy] = useState(false)

  const demo = async () => {
    setDemoBusy(true)
    setErr(null)
    try {
      const r = await api.demoLogin()
      session.set(r.token)
      onLogin(r.user)
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : String(ex))
    } finally {
      setDemoBusy(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const r = await api.login(username, password)
      session.set(r.token)
      onLogin(r.user)
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : String(ex))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative flex flex-col justify-between gap-10 bg-navy px-6 py-8 text-ivory sm:px-10 lg:px-14 lg:py-12">
        <div className="flex items-center gap-4">
          <InstituteMark size={64} />
          <div>
            <div className="font-display text-lg font-semibold leading-tight sm:text-xl">{INSTITUTE}</div>
            <Mono className="text-2xs uppercase tracking-[0.18em] text-ivory/60">Academic Timetable Office</Mono>
          </div>
        </div>
        <div className="max-w-xl">
          <div className="font-display text-[44px] font-bold leading-[0.95] tracking-tight sm:text-[64px]">
            SCHEDULR<span className="ml-1 bg-lime px-2 text-navy">IQ</span>
          </div>
          <p className="mt-4 font-display text-xl text-ivory/85 sm:text-2xl">Every slot has a reason.</p>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-ivory/60">
            Conflict-free timetables built with constraint optimization, independently verified against every
            hard rule, and explained session by session.
          </p>
        </div>
        <div className="hidden max-w-md lg:block">
          <WeekGlyph />
          <div className="mt-2 flex justify-between font-mono text-[9px] uppercase tracking-[0.2em] text-ivory/40">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <span key={d}>{d}</span>)}
          </div>
        </div>
      </section>

      <section className="flex items-center justify-center bg-ivory px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <Mono className="text-2xs uppercase tracking-[0.18em] text-slate">Sign in</Mono>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-slate">Use your timetable office account.</p>

          <label className="mt-8 block">
            <span className="font-mono text-2xs uppercase tracking-wider text-slate">Username</span>
            <input autoFocus autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required
              className="mt-1 h-11 w-full border border-slate-200 bg-white px-3 text-sm focus:border-navy focus:outline-none" />
          </label>
          <label className="mt-4 block">
            <span className="font-mono text-2xs uppercase tracking-wider text-slate">Password</span>
            <span className="relative mt-1 block">
              <input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required
                className="h-11 w-full border border-slate-200 bg-white px-3 pr-10 text-sm focus:border-navy focus:outline-none" />
              <button type="button" onClick={() => setShow(!show)} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate hover:text-navy" aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </span>
          </label>

          {err && <div className="mt-4"><ErrorBox title="Sign-in failed">{err}</ErrorBox></div>}

          <Button tone="primary" type="submit" loading={busy} className="mt-6 h-11 w-full">
            {!busy && <LogIn className="h-4 w-4" />} Sign in
          </Button>

          <div className="my-6 flex items-center gap-3 font-mono text-2xs uppercase tracking-[0.18em] text-slate"><span className="h-px flex-1 bg-navy/15" />or<span className="h-px flex-1 bg-navy/15" /></div>
          <button type="button" onClick={demo} disabled={demoBusy}
            className="group flex w-full items-center gap-3 border border-navy bg-lime px-4 py-3 text-left transition-colors hover:bg-lime-600 disabled:opacity-60">
            <span className="flex-1">
              <span className="block font-display text-base font-semibold">View demo</span>
              <span className="block text-xs text-navy/75">IIIT Surat's official odd-semester timetable · 14 classes · 281 sessions. No sign-in needed.</span>
            </span>
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
          </button>

          <div className="mt-8 grid grid-cols-2 gap-px border border-navy/10 bg-navy/10 text-xs">
            <div className="bg-white p-3"><div className="flex items-center gap-1.5 font-medium"><ShieldCheck className="h-3.5 w-3.5" />Administrator</div><p className="mt-1 text-slate">Edit data & availability, optimize, publish.</p></div>
            <div className="bg-white p-3"><div className="font-medium">Viewer</div><p className="mt-1 text-slate">Read-only access to timetables & reports.</p></div>
          </div>
          {import.meta.env.DEV && (
            <p className="mt-3 font-mono text-2xs text-slate">Dev build · demo accounts are listed in backend/.env.example</p>
          )}
        </form>
      </section>
    </div>
  )
}
