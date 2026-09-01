import axios from 'axios'
import type { PageResponse } from '../types/environment'
import type {
  BatchListParams,
  BatchRunDetailResponse,
  BatchRunResponse,
  BatchStreamHandlers,
} from '../types/batch'

const BASE = '/api/batches'
const _basePath = import.meta.env.BASE_URL.replace(/\/$/, '')

export const batchApi = {
  list: (params: BatchListParams = {}) =>
    axios.get<PageResponse<BatchRunResponse>>(BASE, { params }).then((r) => r.data),

  get: (id: string) =>
    axios.get<BatchRunDetailResponse>(`${BASE}/${id}`).then((r) => r.data),

  cancel: (id: string) =>
    axios.post<BatchRunResponse>(`${BASE}/${id}/cancel`).then((r) => r.data),

  /** Stream batch progress via SSE — returns cleanup function to close the connection. */
  stream: (batchId: string, handlers: BatchStreamHandlers): (() => void) => {
    const url = `${_basePath}${BASE}/${batchId}/stream`
    const eventSource = new EventSource(url)

    eventSource.addEventListener('batch-started', ((e: MessageEvent) => {
      handlers.onBatchStarted?.(JSON.parse(e.data))
    }) as EventListener)

    eventSource.addEventListener('suite-started', ((e: MessageEvent) => {
      handlers.onSuiteStarted?.(JSON.parse(e.data))
    }) as EventListener)

    eventSource.addEventListener('suite-completed', ((e: MessageEvent) => {
      handlers.onSuiteCompleted?.(JSON.parse(e.data))
    }) as EventListener)

    eventSource.addEventListener('batch-complete', ((e: MessageEvent) => {
      handlers.onBatchComplete?.(JSON.parse(e.data))
      eventSource.close()
    }) as EventListener)

    eventSource.addEventListener('batch-error', ((e: MessageEvent) => {
      handlers.onBatchError?.(JSON.parse(e.data))
      eventSource.close()
    }) as EventListener)

    eventSource.onerror = () => {
      if (eventSource.readyState !== EventSource.CLOSED) {
        handlers.onConnectionError?.('Connection lost')
        eventSource.close()
      }
    }

    return () => eventSource.close()
  },
}
