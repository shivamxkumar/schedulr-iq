import type {
  ConflictItem, CheckResult, Dataset, DatasetPayload, GenerateResult, MoveResult, OptimizeResult, ScheduleListItem,
  ScheduleView, SessionExplanation, Weights,
} from './types'

export class ApiError extends Error {
  status: number
  detail: any
  constructor(status: number, detail: any) {
    super(typeof detail === 'string' ? detail : detail?.message || `Request failed (${status})`)
    this.status = status
    this.detail = detail
  }
}

const TOKEN_KEY = 'schedulr.token'
let token: string | null = (() => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } })()
let onUnauthorized: () => void = () => {}

export const session = {
  get token() { return token },
  set(t: string | null) {
    token = t
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* storage blocked */ }
  },
  onUnauthorized(fn: () => void) { onUnauthorized = fn },
}

/** Adds the session token to a GET URL used by plain links (downloads). */
export const withToken = (url: string) => (token ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : url)

export interface User { username: string; role: 'admin' | 'viewer' | 'demo'; name: string }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers || {}) },
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the SCHEDULR IQ backend on :8010. Is it running?')
  }
  const text = await res.text()
  let body: any = text
  try { body = text ? JSON.parse(text) : null } catch { /* plain text */ }
  if (res.status === 401 && path !== '/auth/login') onUnauthorized()
  if (!res.ok) {
    let detail = body?.detail ?? body
    if (Array.isArray(detail)) detail = { message: detail.map((d: any) => `${d.loc?.slice(1).join('.')}: ${d.msg}`).join('; ') }
    throw new ApiError(res.status, detail)
  }
  return body as T
}

const post = <T>(p: string, b?: unknown) => req<T>(p, { method: 'POST', body: b === undefined ? undefined : JSON.stringify(b) })

export const api = {
  login: (username: string, password: string) => post<{ token: string; user: User }>('/auth/login', { username, password }),
  me: () => req<User>('/auth/me'),
  demoLogin: () => post<{ token: string; user: User }>('/auth/demo'),
  health: () => req<{ ok: boolean; solver: string }>('/health'),
  meta: () => req<{ hard_checks: { code: string; label: string }[]; default_weights: Weights }>('/meta'),
  dataset: () => req<DatasetPayload>('/dataset'),
  putDataset: (d: Dataset) => req<DatasetPayload>('/dataset', { method: 'PUT', body: JSON.stringify(d) }),
  validateDataset: (d: Dataset) => post<{ issues: import('./types').DataIssue[]; diagnostics: string[] }>('/dataset/validate', d),
  resetDemo: () => post<DatasetPayload>('/dataset/reset'),
  scenario: (name: string) => post<DatasetPayload>(`/dataset/scenario/${name}`),
  importCsv: (entity: string, csv: string, apply: boolean) =>
    post<{ ok: boolean; rows: number; errors: { row: number; field: string; message: string }[]; issues: any[]; applied?: boolean }>(
      `/dataset/import/${entity}`, { csv, apply }),
  schedules: () => req<{ schedules: ScheduleListItem[]; baseline_id: string | null; active_id: string | null }>('/schedules'),
  schedule: (id: string) => req<ScheduleView>(`/schedule/${id}`),
  activate: (id: string) => post<{ active_id: string }>(`/schedule/${id}/activate`),
  generate: () => post<GenerateResult>('/schedule/generate'),
  optimize: (weights: Weights, time_limit: number, base_id?: string) =>
    post<OptimizeResult>('/schedule/optimize', { weights, time_limit, base_id }),
  move: (id: string, body: { session_id: string; day: number; start: number; room_id?: string; faculty_id?: string; commit?: boolean; force?: boolean }) =>
    post<MoveResult>(`/schedule/${id}/move`, body),
  explain: (id: string, sid: string) => req<SessionExplanation>(`/schedule/${id}/session/${sid}`),
  conflicts: (id: string) => req<{ hard: ConflictItem[]; soft: ConflictItem[]; checks: CheckResult[] }>(`/schedule/${id}/conflicts`),
  publish: (id: string) => post<ScheduleView>(`/schedule/${id}/publish`),
  diagnostic: (id: string) => post<ScheduleView>(`/schedule/${id}/diagnostic`),
  exportUrl: (id: string) => withToken(`/api/schedule/${id}/export`),
  templateUrl: (entity: string) => withToken(`/api/dataset/template/${entity}`),
  entityExportUrl: (entity: string) => withToken(`/api/dataset/export/${entity}`),
}
