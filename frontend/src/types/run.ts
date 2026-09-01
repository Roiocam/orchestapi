import type { SuiteExecutionResult } from '../services/testSuiteApi'

export interface TestRunResponse {
  id: string
  suiteId: string
  suiteName: string
  environmentId: string
  environmentName: string
  triggerType: 'MANUAL' | 'SCHEDULED'
  scheduleId: string | null
  status: 'RUNNING' | 'SUCCESS' | 'PARTIAL_FAILURE' | 'FAILURE' | 'CANCELLED'
  startedAt: string
  completedAt: string | null
  totalDurationMs: number
  resultData: SuiteExecutionResult | null
  createdAt: string
}

export interface RunScheduleResponse {
  id: string
  scopeType: 'SUITE' | 'COLLECTION' | 'PROJECT'
  scopeId: string
  scopeName: string
  suiteCount: number
  /** Present when scopeType is SUITE (back-compat). */
  suiteId: string | null
  suiteName: string | null
  environmentId: string
  environmentName: string
  cronExpression: string
  active: boolean
  description: string | null
  notifyEnabled: boolean
  notifyUrl: string | null
  notifyOn: 'ALWAYS' | 'ON_FAILURE'
  notifyEventName: string | null
  notifyBusinessId: string | null
  notifyOperator: string | null
  notifyExtraLabels: Record<string, string>
  lastRunAt: string | null
  nextRunAt: string | null
  createdAt: string
  updatedAt: string
}

export interface RunScheduleRequest {
  scopeType: 'SUITE' | 'COLLECTION' | 'PROJECT'
  scopeId: string
  environmentId: string
  cronExpression: string
  description?: string
  notifyEnabled?: boolean
  notifyUrl?: string
  notifyOn?: 'ALWAYS' | 'ON_FAILURE'
  notifyEventName?: string
  notifyBusinessId?: string
  notifyOperator?: string
  notifyExtraLabels?: Record<string, string>
  /** @deprecated prefer scopeType=SUITE + scopeId */
  suiteId?: string
}

export interface CronPreviewResponse {
  valid: boolean
  error: string | null
  nextFireTimes: string[]
}

export interface RunListParams {
  page?: number
  size?: number
  suiteName?: string
  status?: string
  environmentId?: string
  triggerType?: string
  from?: string
  to?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

export interface ScheduleListParams {
  page?: number
  size?: number
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

export interface DashboardStats {
  totalRuns: number
  successCount: number
  failureCount: number
  partialFailureCount: number
  cancelledCount: number
  runningCount: number
  activeSchedules: number
  totalSuites: number
  totalEnvironments: number
}
