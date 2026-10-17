export interface Window { day: number; start: number; end: number }
export interface TimeConfig {
  days: string[]; day_start: string; slot_minutes: number; slots_per_day: number;
  break_slots: number[]; day_slots: number[]
}
export type RoomType = 'lecture' | 'lab' | 'seminar'
export type CourseType = 'lecture' | 'lab' | 'tutorial'
export interface Room { id: string; name: string; capacity: number; room_type: RoomType; equipment: string[]; unavailable: Window[] }
export interface Faculty {
  id: string; name: string; department: string; courses: string[]; unavailable: Window[]; dispreferred: Window[];
  max_daily_slots: number; max_weekly_slots: number
}
export interface Batch { id: string; name: string; size: number; program: string; section?: string }
export interface Course {
  id: string; code: string; name: string; course_type: CourseType; category: string; batch_ids: string[];
  sessions_per_week: number; duration_slots: number; room_types: RoomType[]; equipment: string[]; eligible_starts: Window[]
}
export interface Dataset {
  name: string; time: TimeConfig; rooms: Room[]; faculty: Faculty[]; batches: Batch[]; courses: Course[];
  fixed: { session_id: string; day: number; start: number; room_id?: string | null }[]
}
export interface Session { id: string; course_id: string; index: number; batch_ids: string[]; duration: number; enrollment: number }
export interface DataIssue { level: 'error' | 'warning'; entity: string; id: string; field: string; message: string }
export interface DatasetPayload { dataset: Dataset; version: number; issues: DataIssue[]; sessions: Session[]; slot_labels: string[] }

export interface Assignment { session_id: string; day: number; start: number; room_id: string; faculty_id: string }
export interface Violation {
  code: string; severity: 'hard' | 'soft'; message: string; session_ids: string[];
  resource_kind?: string | null; resource_id?: string | null; day?: number | null; start?: number | null; end?: number | null
}
export interface CheckResult { code: string; label: string; violations: number; passed: boolean }
export interface ValidationReport {
  feasible: boolean; complete: boolean; hard_count: number; soft_count: number; scheduled: number; required: number;
  checks: CheckResult[]; violations: Violation[]
}
export interface EntityLoad { id: string; name: string; weekly_slots: number; daily_slots: number[]; idle_minutes: number }
export interface RoomUse { id: string; occupied_slots: number; available_slots: number; utilization: number; seat_utilization: number | null }
export interface Metrics {
  scheduled_sessions: number; required_sessions: number; unscheduled_sessions: number;
  student_idle_minutes: number; faculty_idle_minutes: number; room_time_utilization: number; seat_utilization: number;
  wasted_seat_hours: number; workload_imbalance_hours: number; preference_misses: number; preference_satisfaction: number;
  terms: Record<string, number>; faculty: EntityLoad[]; batches: EntityLoad[]; rooms: RoomUse[]
}
export interface Change {
  session_id: string; course_code: string; kind: string[]; headline: string; effects: string[];
  before: Assignment | null; after: Assignment | null
}
export interface Weights { student_idle: number; faculty_idle: number; room_fit: number; workload_balance: number; preferences: number }
export interface ScheduleRecord {
  id: string; label: string; kind: 'baseline' | 'optimized' | 'manual' | 'draft' | 'diagnostic' | 'partial';
  parent_id: string | null; created_at: string; assignments: Assignment[];
  solver: Record<string, any>; weights: Weights | null; published: boolean; published_at: string | null; changes: Change[]
}
export interface ScheduleView {
  record: ScheduleRecord; validation: ValidationReport; metrics: Metrics; score: number; score_weights: Weights; publishable: boolean
}
export interface ScheduleListItem {
  id: string; label: string; kind: string; created_at: string; parent_id: string | null; published: boolean; hard_count: number; status: string
}
export interface SlotCell { day: number; start: number; status: 'current' | 'feasible' | 'blocked'; reason?: string | null; reason_label?: string | null; room_id?: string | null; score_delta?: number | null }
export interface SessionExplanation {
  session_id: string; course: Course; assignment: Assignment | null; enrollment: number; batches: string[];
  requirements: string[]; checks: { code: string; label: string; passed: boolean; detail: string | null }[];
  rooms: { room_id: string; suitable: boolean; reasons: string[] }[]; slots: SlotCell[]; summary: string[]; preference: string | null
}
export interface Suggestion { session_id: string; assignment: Assignment; label: string; score_delta: number }
export interface ConflictItem extends Violation { suggestions: Suggestion[] }
export interface MoveResult { valid: boolean; introduced: Violation[]; validation: ValidationReport; committed: boolean; schedule: ScheduleView | null }
export interface OptimizeResult {
  status: string; message?: string; diagnostics?: string[]; log?: string[];
  schedule?: ScheduleView; base?: ScheduleView; base_score_same_weights?: number; note?: string
}
export interface GenerateResult { status: string; message?: string; diagnostics?: string[]; schedule?: ScheduleView; partial?: ScheduleView | null }
