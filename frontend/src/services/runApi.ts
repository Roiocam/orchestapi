import axios from 'axios'
import type { PageResponse } from '../types/environment'
import type { TestRunResponse, RunListParams, DashboardStats } from '../types/run'
import type { StepExecutionResult, SuiteExecutionResult } from './testSuiteApi'

const BASE = '/api/runs'
const _basePath = import.meta.env.BASE_URL.replace(/\/$/, '')

export interface RunStreamHandlers {
  onStep?: (step: StepExecutionResult) => void
  onComplete?: (result: SuiteExecutionResult) => void
  onError?: (error: string) => void
  onRunStarted?: (data: { runId: string }) => void
}

export const runApi = {
  list: (params: RunListParams = {}) =>
    axios.get<PageResponse<TestRunResponse>>(BASE, { params }).then(r => r.data),

  get: (id: string) =>
    axios.get<TestRunResponse>(`${BASE}/${id}`).then(r => r.data),

  delete: (id: string) =>
    axios.delete(`${BASE}/${id}`),

  export: (id: string) =>
    axios.get<TestRunResponse>(`${BASE}/${id}/export`).then(r => r.data),

  stats: () =>
    axios.get<DashboardStats>(`${BASE}/stats`).then(r => r.data),

  /** Attach to an existing run's step progress via SSE. */
  stream: (runId: string, handlers: RunStreamHandlers): (() => void) => {
    const url = `${_basePath}${BASE}/${runId}/stream`
    const eventSource = new EventSource(url)

    eventSource.addEventListener('run-started', ((e: MessageEvent) => {
      handlers.onRunStarted?.(JSON.parse(e.data))
    }) as EventListener)

    eventSource.addEventListener('step', ((e: MessageEvent) => {
      handlers.onStep?.(JSON.parse(e.data) as StepExecutionResult)
    }) as EventListener)

    eventSource.addEventListener('complete', ((e: MessageEvent) => {
      handlers.onComplete?.(JSON.parse(e.data) as SuiteExecutionResult)
      eventSource.close()
    }) as EventListener)

    eventSource.addEventListener('run-error', ((e: MessageEvent) => {
      const data = JSON.parse(e.data)
      handlers.onError?.(data.message || 'Unknown error')
      eventSource.close()
    }) as EventListener)

    eventSource.onerror = () => {
      if (eventSource.readyState !== EventSource.CLOSED) {
        handlers.onError?.('Connection lost')
        eventSource.close()
      }
    }

    return () => eventSource.close()
  },
}
