import type { CollectionSuiteRunResult } from './project'
import type { TestRunResponse } from './run'

export type BatchScopeType = 'COLLECTION' | 'PROJECT'
export type BatchTriggerType = 'MANUAL' | 'SCHEDULED'
export type BatchStatus = 'RUNNING' | 'SUCCESS' | 'PARTIAL_FAILURE' | 'FAILURE' | 'CANCELLED'

export interface BatchRunResponse {
  id: string
  scopeType: BatchScopeType
  scopeId: string
  scopeName: string
  environmentId: string | null
  scheduleId: string | null
  triggerType: BatchTriggerType
  status: BatchStatus
  totalSuites: number
  succeeded: number
  failed: number
  startedAt: string
  completedAt: string | null
  createdAt: string
}

export interface BatchRunDetailResponse {
  batch: BatchRunResponse
  runs: CollectionSuiteRunResult[]
}

export interface BatchRunExportResponse {
  batch: BatchRunResponse
  runs: TestRunResponse[]
}

export interface BatchStartResponse {
  batchId: string
}

export interface BatchListParams {
  page?: number
  size?: number
  triggerType?: string
  status?: string
  from?: string
  to?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

export interface BatchStartedEvent {
  batchId: string
  totalSuites: number
}

export interface BatchSuiteStartedEvent {
  suiteId: string
  suiteName: string
  runId: string
}

export interface BatchSuiteCompletedEvent {
  suiteId: string
  suiteName: string
  runId: string
  status: string
  errorMessage?: string
}

export interface BatchCompleteEvent {
  batchId: string
  status: string
  succeeded: number
  failed: number
  totalSuites: number
}

export interface BatchErrorEvent {
  batchId?: string
  message?: string
}

export interface BatchStreamHandlers {
  onBatchStarted?: (data: BatchStartedEvent) => void
  onSuiteStarted?: (data: BatchSuiteStartedEvent) => void
  onSuiteCompleted?: (data: BatchSuiteCompletedEvent) => void
  onBatchComplete?: (data: BatchCompleteEvent) => void
  onBatchError?: (data: BatchErrorEvent) => void
  onConnectionError?: (message: string) => void
}
