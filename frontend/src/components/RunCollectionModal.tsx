import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Form, Modal, Select, message, Progress, List, Tag, Button, Space } from 'antd'
import { PlayCircleOutlined, StopOutlined, LoadingOutlined } from '@ant-design/icons'
import { environmentApi } from '../services/environmentApi'
import { collectionApi } from '../services/projectApi'
import { batchApi } from '../services/batchApi'
import type { BatchCompleteEvent } from '../types/batch'

export interface RunCollectionTarget {
  id: string
  name: string
  suiteCount: number
}

type SuiteProgressStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILURE' | 'PARTIAL_FAILURE' | 'CANCELLED' | 'ERROR'

interface SuiteProgress {
  suiteId: string
  suiteName: string
  runId?: string
  status: SuiteProgressStatus
  errorMessage?: string
}

const SUITE_STATUS_COLOR: Record<string, string> = {
  PENDING: 'default',
  RUNNING: 'processing',
  SUCCESS: 'green',
  FAILURE: 'red',
  PARTIAL_FAILURE: 'orange',
  CANCELLED: 'default',
  ERROR: 'red',
}

function formatRunMessage(succeeded: number, failed: number): void {
  if (failed === 0) {
    message.success(
      `Collection run completed: ${succeeded} suite${succeeded === 1 ? '' : 's'} succeeded`,
    )
    return
  }
  if (succeeded === 0) {
    message.error(`Collection run failed: ${failed} suite${failed === 1 ? '' : 's'} failed`)
    return
  }
  message.warning(
    `Collection run completed: ${succeeded} succeeded, ${failed} failed`,
  )
}

export function useRunCollection() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [target, setTarget] = useState<RunCollectionTarget | null>(null)
  const [selectedEnvId, setSelectedEnvId] = useState<string | undefined>(undefined)
  const [environments, setEnvironments] = useState<{ label: string; value: string }[]>([])
  const [batchId, setBatchId] = useState<string | null>(null)
  const [totalSuites, setTotalSuites] = useState(0)
  const [suites, setSuites] = useState<SuiteProgress[]>([])
  const [cancelling, setCancelling] = useState(false)
  const closeStreamRef = useRef<(() => void) | null>(null)

  const resetProgress = useCallback(() => {
    closeStreamRef.current?.()
    closeStreamRef.current = null
    setBatchId(null)
    setTotalSuites(0)
    setSuites([])
    setCancelling(false)
  }, [])

  const openRunCollection = useCallback((next: RunCollectionTarget) => {
    if (next.suiteCount === 0) {
      message.warning('This collection has no suites to run')
      return
    }
    resetProgress()
    setTarget(next)
    setSelectedEnvId(undefined)
    setOpen(true)
  }, [resetProgress])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    environmentApi
      .list({ page: 0, size: 100 })
      .then((page) => {
        if (!cancelled) {
          setEnvironments(page.content.map((env) => ({ label: env.name, value: env.id })))
        }
      })
      .catch(() => {
        if (!cancelled) message.error('Failed to load environments')
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    return () => {
      closeStreamRef.current?.()
    }
  }, [])

  const handleBatchComplete = useCallback((data: BatchCompleteEvent) => {
    formatRunMessage(data.succeeded, data.failed)
    setRunning(false)
    setOpen(false)
    resetProgress()
    navigate(`/runs/batches/${data.batchId}`)
  }, [navigate, resetProgress])

  const connectStream = useCallback((id: string) => {
    closeStreamRef.current?.()
    closeStreamRef.current = batchApi.stream(id, {
      onBatchStarted: (data) => {
        setTotalSuites(data.totalSuites)
      },
      onSuiteStarted: (data) => {
        setSuites((prev) => {
          const existing = prev.find((s) => s.suiteId === data.suiteId)
          if (existing) {
            return prev.map((s) =>
              s.suiteId === data.suiteId
                ? { ...s, status: 'RUNNING' as const, runId: data.runId }
                : s,
            )
          }
          return [
            ...prev,
            {
              suiteId: data.suiteId,
              suiteName: data.suiteName,
              runId: data.runId,
              status: 'RUNNING',
            },
          ]
        })
      },
      onSuiteCompleted: (data) => {
        setSuites((prev) => {
          const existing = prev.find((s) => s.suiteId === data.suiteId)
          const status = (data.status as SuiteProgressStatus) || 'FAILURE'
          if (existing) {
            return prev.map((s) =>
              s.suiteId === data.suiteId
                ? {
                    ...s,
                    status,
                    runId: data.runId,
                    errorMessage: data.errorMessage,
                  }
                : s,
            )
          }
          return [
            ...prev,
            {
              suiteId: data.suiteId,
              suiteName: data.suiteName,
              runId: data.runId,
              status,
              errorMessage: data.errorMessage,
            },
          ]
        })
      },
      onBatchComplete: handleBatchComplete,
      onBatchError: (data) => {
        message.error(data.message || 'Batch run failed')
        setRunning(false)
      },
      onConnectionError: (msg) => {
        message.error(msg)
        setRunning(false)
      },
    })
  }, [handleBatchComplete])

  const close = useCallback(() => {
    if (running) return
    setOpen(false)
    resetProgress()
  }, [running, resetProgress])

  const confirm = useCallback(async () => {
    if (!target || running) return
    setRunning(true)
    resetProgress()
    try {
      const { batchId: newBatchId } = await collectionApi.run(target.id, selectedEnvId)
      setBatchId(newBatchId)
      connectStream(newBatchId)
    } catch (err: unknown) {
      setRunning(false)
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        message.error(axiosErr.response?.data?.error ?? 'Failed to run collection')
      } else {
        message.error('Failed to run collection')
      }
    }
  }, [target, selectedEnvId, running, resetProgress, connectStream])

  const handleCancel = useCallback(async () => {
    if (!batchId || cancelling) return
    setCancelling(true)
    try {
      await batchApi.cancel(batchId)
      message.info('Batch cancellation requested')
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string }; status?: number } }
        message.error(axiosErr.response?.data?.error ?? 'Failed to cancel batch')
      } else {
        message.error('Failed to cancel batch')
      }
    } finally {
      setCancelling(false)
    }
  }, [batchId, cancelling])

  const completedCount = suites.filter((s) =>
    ['SUCCESS', 'FAILURE', 'PARTIAL_FAILURE', 'CANCELLED', 'ERROR'].includes(s.status),
  ).length
  const progressTotal = totalSuites || target?.suiteCount || 0
  const progressPercent = progressTotal > 0
    ? Math.round((completedCount / progressTotal) * 100)
    : 0

  const modal = (
    <Modal
      title="Run Collection"
      open={open}
      onOk={running ? undefined : confirm}
      onCancel={close}
      okText="Run"
      confirmLoading={running && !batchId}
      okButtonProps={{
        icon: <PlayCircleOutlined />,
        disabled: !target || target.suiteCount === 0 || running,
        style: running ? { display: 'none' } : undefined,
      }}
      cancelText={running ? 'Close' : 'Cancel'}
      cancelButtonProps={{ disabled: running }}
      footer={running ? (
        <Space>
          <Button onClick={close} disabled>Close</Button>
          <Button
            danger
            icon={<StopOutlined />}
            loading={cancelling}
            onClick={handleCancel}
          >
            Cancel Batch
          </Button>
        </Space>
      ) : undefined}
      destroyOnClose
      width={520}
    >
      {target && (
        <>
          {!running ? (
            <>
              <div className="form-hint" style={{ marginTop: 0 }}>
                Run all <strong>{target.suiteCount}</strong> suite
                {target.suiteCount === 1 ? '' : 's'} in <strong>{target.name}</strong>.
              </div>
              <Form layout="vertical" requiredMark="optional" style={{ marginTop: 14 }}>
                <Form.Item
                  label="Environment"
                  extra="Leave empty to use each suite's default when set."
                  style={{ marginBottom: 8 }}
                >
                  <Select
                    showSearch
                    allowClear
                    placeholder="Select an environment (optional)"
                    value={selectedEnvId}
                    onChange={(val) => setSelectedEnvId(val)}
                    options={environments}
                    filterOption={(input, option) =>
                      (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Form>
            </>
          ) : (
            <div>
              <div className="form-hint" style={{ marginTop: 0, marginBottom: 16 }}>
                Running <strong>{target.name}</strong>
                {batchId && (
                  <span style={{ marginLeft: 8, color: '#888', fontSize: 12 }}>
                    Batch {batchId.slice(0, 8)}…
                  </span>
                )}
              </div>
              <Progress
                percent={progressPercent}
                status={progressPercent < 100 ? 'active' : 'success'}
                format={() => `${completedCount} / ${progressTotal}`}
                style={{ marginBottom: 16 }}
              />
              {suites.length > 0 ? (
                <List
                  size="small"
                  bordered
                  dataSource={suites}
                  style={{ maxHeight: 280, overflow: 'auto' }}
                  renderItem={(item) => (
                    <List.Item style={{ padding: '8px 12px' }}>
                      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                        <span>{item.suiteName}</span>
                        <Tag
                          icon={item.status === 'RUNNING' ? <LoadingOutlined spin /> : undefined}
                          color={SUITE_STATUS_COLOR[item.status] ?? 'default'}
                        >
                          {item.status.replace('_', ' ')}
                        </Tag>
                      </Space>
                      {item.errorMessage && (
                        <div style={{ fontSize: 12, color: '#ff4d4f', marginTop: 4, width: '100%' }}>
                          {item.errorMessage}
                        </div>
                      )}
                    </List.Item>
                  )}
                />
              ) : (
                <div style={{ color: '#888', textAlign: 'center', padding: '16px 0' }}>
                  <LoadingOutlined spin style={{ marginRight: 8 }} />
                  Starting batch…
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  )

  return { openRunCollection, modal, running }
}
