import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Button,
  Drawer,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  EyeOutlined,
  StopOutlined,
} from '@ant-design/icons'
import type { TFunction } from 'i18next'
import type { BatchRunDetailResponse, BatchRunResponse } from '../types/batch'
import type { TestRunResponse } from '../types/run'
import type { SuiteExecutionResult, StepExecutionResult } from '../services/testSuiteApi'
import { batchApi } from '../services/batchApi'
import { runApi } from '../services/runApi'
import RunResultsPanel from '../components/RunResultsPanel'
import { formatDateTime } from '../utils/datetime'

const { Text, Title } = Typography

const STATUS_TAG_COLOR: Record<string, string> = {
  PENDING: 'default',
  SUCCESS: 'green',
  FAILURE: 'red',
  PARTIAL_FAILURE: 'orange',
  RUNNING: 'processing',
  CANCELLED: 'default',
}

const TRIGGER_TAG_COLOR: Record<string, string> = {
  MANUAL: 'default',
  SCHEDULED: 'purple',
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = ((ms % 60_000) / 1000).toFixed(0)
  return `${mins}m ${secs}s`
}

function translateStatus(status: string, t: TFunction): string {
  return t(`pages.runs.status${status}`, { defaultValue: status.replace('_', ' ') })
}

function translateTrigger(trigger: string, t: TFunction): string {
  return t(`pages.runs.trigger${trigger}`, { defaultValue: trigger })
}

function translateScope(scope: string, t: TFunction): string {
  return t(`pages.runs.scope${scope}`, { defaultValue: scope })
}

export default function BatchDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [detail, setDetail] = useState<BatchRunDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState(false)
  const streamRef = useRef<(() => void) | null>(null)

  const [viewDrawer, setViewDrawer] = useState<string | null>(null)
  const [viewLoading, setViewLoading] = useState(false)
  const [liveResult, setLiveResult] = useState<SuiteExecutionResult | null>(null)
  const runStreamRef = useRef<(() => void) | null>(null)

  const loadDetail = useCallback(async (batchId: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const data = await batchApi.get(batchId)
      setDetail(data)
      return data
    } catch {
      if (!opts?.silent) {
        message.error(t('pages.batchDetail.failedLoad'))
        setDetail(null)
      }
      return null
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (!id) return
    loadDetail(id)
  }, [id, loadDetail])

  useEffect(() => {
    if (!id || detail?.batch.status !== 'RUNNING') {
      streamRef.current?.()
      streamRef.current = null
      return
    }

    streamRef.current?.()
    streamRef.current = batchApi.stream(id, {
      onSuiteStarted: (data) => {
        setDetail((prev) => {
          if (!prev) return prev
          const runs = prev.runs.map((r) =>
            r.suiteId === data.suiteId
              ? {
                  ...r,
                  id: data.runId,
                  status: 'RUNNING' as const,
                  startedAt: new Date().toISOString(),
                }
              : r,
          )
          // If suite was not pre-listed (legacy batches), append it
          if (!runs.some((r) => r.suiteId === data.suiteId)) {
            runs.push({
              id: data.runId,
              suiteId: data.suiteId,
              suiteName: data.suiteName,
              environmentId: prev.batch.environmentId ?? '',
              environmentName: '',
              triggerType: prev.batch.triggerType,
              scheduleId: prev.batch.scheduleId,
              status: 'RUNNING',
              startedAt: new Date().toISOString(),
              completedAt: null,
              totalDurationMs: 0,
              resultData: null,
              createdAt: new Date().toISOString(),
            })
          }
          return { ...prev, runs }
        })
      },
      onSuiteCompleted: (data) => {
        setDetail((prev) => {
          if (!prev) return prev
          const runs = prev.runs.map((r) =>
            r.suiteId === data.suiteId
              ? {
                  ...r,
                  id: data.runId,
                  status: data.status as TestRunResponse['status'],
                }
              : r,
          )
          return { ...prev, runs }
        })
        // Refresh so startedAt / totalDurationMs match persisted run list fields
        loadDetail(id, { silent: true })
      },
      onBatchComplete: (data) => {
        setDetail((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            batch: {
              ...prev.batch,
              status: data.status as BatchRunResponse['status'],
              succeeded: data.succeeded,
              failed: data.failed,
              totalSuites: data.totalSuites,
            },
          }
        })
        loadDetail(id, { silent: true })
      },
      onBatchError: () => {
        if (id) loadDetail(id)
      },
    })

    return () => {
      streamRef.current?.()
      streamRef.current = null
    }
  }, [id, detail?.batch.status, loadDetail])

  useEffect(() => {
    return () => {
      runStreamRef.current?.()
      runStreamRef.current = null
    }
  }, [])

  const closeRunDrawer = () => {
    runStreamRef.current?.()
    runStreamRef.current = null
    setViewDrawer(null)
    setLiveResult(null)
  }

  const handleExport = async () => {
    if (!id) return
    try {
      const exportData = await batchApi.export(id)
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `batch-${id}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 100)
    } catch {
      message.error(t('pages.batchDetail.failedExport'))
    }
  }

  const handleCancel = async () => {
    if (!id) return
    setCancelling(true)
    try {
      const updated = await batchApi.cancel(id)
      setDetail((prev) => (prev ? { ...prev, batch: updated } : prev))
      message.info(t('components.runCollection.cancellationRequested'))
      await loadDetail(id, { silent: true })
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        message.error(axiosErr.response?.data?.error ?? t('components.runCollection.failedCancelBatch'))
      } else {
        message.error(t('components.runCollection.failedCancelBatch'))
      }
    } finally {
      setCancelling(false)
    }
  }

  const handleViewRun = async (runId: string) => {
    runStreamRef.current?.()
    runStreamRef.current = null
    setViewDrawer(runId)
    setViewLoading(true)
    setLiveResult(null)
    try {
      const run = await runApi.get(runId)

      if (run.status === 'RUNNING') {
        setLiveResult({ status: 'RUNNING', steps: [], totalDurationMs: 0 })
        let receivedStep = false
        runStreamRef.current = runApi.stream(runId, {
          onStep: (step: StepExecutionResult) => {
            receivedStep = true
            setLiveResult((prev) => {
              if (!prev) return { status: 'RUNNING', steps: [step], totalDurationMs: 0 }
              return { ...prev, steps: [...prev.steps, step] }
            })
          },
          onComplete: (result) => {
            setLiveResult(result)
            runStreamRef.current = null
          },
          onError: (error) => {
            runStreamRef.current = null
            if (!receivedStep) {
              message.error(error || t('pages.batchDetail.failedStreamRun'))
            }
          },
        })
      } else if (run.resultData) {
        setLiveResult(run.resultData as SuiteExecutionResult)
      }
    } catch {
      message.error(t('pages.runs.failedLoadRunDetails'))
      setViewDrawer(null)
    } finally {
      setViewLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!detail) {
    return (
      <div>
        <div className="page-header">
          <div className="suite-detail-title-wrap">
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/runs?tab=batches')} />
            <div className="page-header-copy">
              <div className="page-header-kicker">{t('pages.batchDetail.kicker')}</div>
              <Title level={4} className="page-header-title" style={{ fontSize: 18 }}>
                {t('pages.batchDetail.notFound')}
              </Title>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const { batch, runs } = detail

  return (
    <div>
      <div className="page-header">
        <div className="suite-detail-title-wrap">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/runs?tab=batches')} />
          <div className="page-header-copy">
            <div className="page-header-kicker">{t('pages.batchDetail.kicker')}</div>
            <Title level={4} className="page-header-title" style={{ fontSize: 18 }}>
              {batch.scopeName}
            </Title>
          </div>
        </div>
        <div className="page-header-actions">
          <Space>
            <Button icon={<DownloadOutlined />} onClick={handleExport}>
              {t('common.export')}
            </Button>
            {batch.status === 'RUNNING' && (
              <Button
                danger
                icon={<StopOutlined />}
                loading={cancelling}
                onClick={handleCancel}
              >
                {t('common.cancel')}
              </Button>
            )}
          </Space>
        </div>
      </div>

      <div className="product-panel" style={{ marginBottom: 14 }}>
        <div className="product-panel-header">
          <div>
            <div className="product-panel-title">{t('pages.batchDetail.summary')}</div>
            <div className="product-panel-subtitle">
              {t('pages.batchDetail.summarySubtitle')}
            </div>
          </div>
        </div>
        <div className="product-panel-body">
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space wrap>
              <Tag>{translateScope(batch.scopeType, t)}</Tag>
              <Tag color={STATUS_TAG_COLOR[batch.status] ?? 'default'}>
                {translateStatus(batch.status, t)}
              </Tag>
              <Tag color={TRIGGER_TAG_COLOR[batch.triggerType] ?? 'default'}>
                {translateTrigger(batch.triggerType, t)}
              </Tag>
              <Text type="secondary">
                {t('pages.batchDetail.summaryStats', {
                  succeeded: batch.succeeded,
                  failed: batch.failed,
                  total: batch.totalSuites,
                })}
              </Text>
            </Space>
            {batch.startedAt && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('pages.batchDetail.startedAt', { time: formatDateTime(batch.startedAt) })}
                {batch.completedAt && (
                  <> · {t('pages.batchDetail.completedAt', { time: formatDateTime(batch.completedAt) })}</>
                )}
                {batch.totalDurationMs != null && (
                  <> · {t('pages.runs.columnDuration')}: {formatDuration(batch.totalDurationMs)}</>
                )}
              </Text>
            )}
          </Space>
        </div>
      </div>

      <div className="product-panel">
        <div className="product-panel-header">
          <div>
            <div className="product-panel-title">{t('pages.batchDetail.suiteRuns')}</div>
            <div className="product-panel-subtitle">
              {t('pages.batchDetail.suiteRunsSubtitle')}
            </div>
          </div>
        </div>
        <div className="product-panel-body" style={{ paddingTop: 0 }}>
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={runs}
            columns={[
              {
                title: t('pages.batchDetail.columnSuite'),
                dataIndex: 'suiteName',
                key: 'suiteName',
              },
              {
                title: t('pages.runs.columnEnvironment'),
                dataIndex: 'environmentName',
                key: 'environmentName',
                width: 120,
              },
              {
                title: t('pages.runs.columnStatus'),
                dataIndex: 'status',
                key: 'status',
                width: 140,
                render: (status: string) => (
                  <Tag color={STATUS_TAG_COLOR[status] ?? 'default'}>
                    {translateStatus(status, t)}
                  </Tag>
                ),
              },
              {
                title: t('pages.runs.columnDuration'),
                dataIndex: 'totalDurationMs',
                key: 'totalDurationMs',
                width: 100,
                render: (ms: number | null, record: TestRunResponse) =>
                  record.status === 'PENDING' || ms == null ? '\u2014' : formatDuration(ms),
              },
              {
                title: t('pages.runs.columnStartedAt'),
                dataIndex: 'startedAt',
                key: 'startedAt',
                width: 170,
                render: (v: string | null, record: TestRunResponse) =>
                  record.status === 'PENDING' ? '\u2014' : formatDateTime(v),
              },
              {
                title: t('common.actions'),
                key: 'actions',
                width: 80,
                render: (_: unknown, record: TestRunResponse) =>
                  record.id ? (
                    <Tooltip title={t('pages.batchDetail.viewRun')}>
                      <Button
                        type="text"
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={() => handleViewRun(record.id)}
                      />
                    </Tooltip>
                  ) : null,
              },
            ]}
          />
        </div>
      </div>

      <Drawer
        title={t('pages.batchDetail.runDetailsTitle')}
        open={!!viewDrawer}
        onClose={closeRunDrawer}
        width={800}
        destroyOnClose
      >
        {viewLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : liveResult ? (
          <RunResultsPanel
            result={liveResult}
            allSteps={[]}
            targetStepId={null}
            onClose={closeRunDrawer}
          />
        ) : (
          <div style={{ color: '#888', textAlign: 'center', padding: 40 }}>
            {t('pages.batchDetail.noResultData')}
          </div>
        )}
      </Drawer>
    </div>
  )
}
