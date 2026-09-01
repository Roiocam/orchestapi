import { useCallback, useEffect, useRef, useState } from 'react'
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
import type { BatchRunDetailResponse, BatchRunResponse } from '../types/batch'
import type { CollectionSuiteRunResult } from '../types/project'
import type { TestRunResponse } from '../types/run'
import type { SuiteExecutionResult } from '../services/testSuiteApi'
import { batchApi } from '../services/batchApi'
import { runApi } from '../services/runApi'
import RunResultsPanel from '../components/RunResultsPanel'

const { Text, Title } = Typography

const STATUS_TAG_COLOR: Record<string, string> = {
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

export default function BatchDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [detail, setDetail] = useState<BatchRunDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState(false)
  const streamRef = useRef<(() => void) | null>(null)

  const [viewDrawer, setViewDrawer] = useState<string | null>(null)
  const [viewDetail, setViewDetail] = useState<TestRunResponse | null>(null)
  const [viewLoading, setViewLoading] = useState(false)

  const loadDetail = useCallback(async (batchId: string) => {
    setLoading(true)
    try {
      const data = await batchApi.get(batchId)
      setDetail(data)
      return data
    } catch {
      message.error('Failed to load batch details')
      setDetail(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

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
          const runs = [...prev.runs]
          const idx = runs.findIndex((r) => r.suiteId === data.suiteId)
          const entry: CollectionSuiteRunResult = {
            suiteId: data.suiteId,
            suiteName: data.suiteName,
            runId: data.runId,
            status: 'RUNNING',
            errorMessage: null,
          }
          if (idx >= 0) runs[idx] = entry
          else runs.push(entry)
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
                  runId: data.runId,
                  status: data.status,
                  errorMessage: data.errorMessage ?? null,
                }
              : r,
          )
          return { ...prev, runs }
        })
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
      message.error('Failed to export batch')
    }
  }

  const handleCancel = async () => {
    if (!id) return
    setCancelling(true)
    try {
      const updated = await batchApi.cancel(id)
      setDetail((prev) => (prev ? { ...prev, batch: updated } : prev))
      message.info('Batch cancellation requested')
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        message.error(axiosErr.response?.data?.error ?? 'Failed to cancel batch')
      } else {
        message.error('Failed to cancel batch')
      }
    } finally {
      setCancelling(false)
    }
  }

  const handleViewRun = async (runId: string) => {
    setViewDrawer(runId)
    setViewLoading(true)
    setViewDetail(null)
    try {
      const run = await runApi.get(runId)
      setViewDetail(run)
    } catch {
      message.error('Failed to load run details')
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
              <div className="page-header-kicker">Batch</div>
              <Title level={4} className="page-header-title" style={{ fontSize: 18 }}>
                Batch not found
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
            <div className="page-header-kicker">Batch</div>
            <Title level={4} className="page-header-title" style={{ fontSize: 18 }}>
              {batch.scopeName}
            </Title>
          </div>
        </div>
        <div className="page-header-actions">
          <Space>
            <Button icon={<DownloadOutlined />} onClick={handleExport}>
              Export
            </Button>
            {batch.status === 'RUNNING' && (
              <Button
                danger
                icon={<StopOutlined />}
                loading={cancelling}
                onClick={handleCancel}
              >
                Cancel
              </Button>
            )}
          </Space>
        </div>
      </div>

      <div className="product-panel" style={{ marginBottom: 14 }}>
        <div className="product-panel-header">
          <div>
            <div className="product-panel-title">Summary</div>
            <div className="product-panel-subtitle">
              Collection/project batch execution status and timing.
            </div>
          </div>
        </div>
        <div className="product-panel-body">
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space wrap>
              <Tag>{batch.scopeType}</Tag>
              <Tag color={STATUS_TAG_COLOR[batch.status] ?? 'default'}>
                {batch.status.replace('_', ' ')}
              </Tag>
              <Tag color={TRIGGER_TAG_COLOR[batch.triggerType] ?? 'default'}>
                {batch.triggerType}
              </Tag>
              <Text type="secondary">
                {batch.succeeded} succeeded, {batch.failed} failed / {batch.totalSuites} total
              </Text>
            </Space>
            {batch.startedAt && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Started {new Date(batch.startedAt).toLocaleString()}
                {batch.completedAt && (
                  <> · Completed {new Date(batch.completedAt).toLocaleString()}</>
                )}
              </Text>
            )}
          </Space>
        </div>
      </div>

      <div className="product-panel">
        <div className="product-panel-header">
          <div>
            <div className="product-panel-title">Suite runs</div>
            <div className="product-panel-subtitle">
              Open a suite run to inspect request and response bodies.
            </div>
          </div>
        </div>
        <div className="product-panel-body" style={{ paddingTop: 0 }}>
          <Table
            size="small"
            rowKey="suiteId"
            pagination={false}
            dataSource={runs}
            columns={[
              {
                title: 'Suite',
                dataIndex: 'suiteName',
                key: 'suiteName',
              },
              {
                title: 'Status',
                dataIndex: 'status',
                key: 'status',
                width: 140,
                render: (status: string) => (
                  <Tag color={STATUS_TAG_COLOR[status] ?? 'default'}>
                    {status.replace('_', ' ')}
                  </Tag>
                ),
              },
              {
                title: 'Actions',
                key: 'actions',
                width: 80,
                render: (_: unknown, record: CollectionSuiteRunResult) =>
                  record.runId ? (
                    <Tooltip title="View run">
                      <Button
                        type="text"
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={() => handleViewRun(record.runId!)}
                      />
                    </Tooltip>
                  ) : null,
              },
            ]}
            expandable={{
              expandedRowRender: (record) =>
                record.errorMessage ? (
                  <Text type="danger" style={{ fontSize: 12 }}>{record.errorMessage}</Text>
                ) : null,
              rowExpandable: (record) => !!record.errorMessage,
            }}
          />
        </div>
      </div>

      <Drawer
        title="Run Details"
        open={!!viewDrawer}
        onClose={() => { setViewDrawer(null); setViewDetail(null) }}
        width={800}
        destroyOnClose
      >
        {viewLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : viewDetail?.resultData ? (
          <RunResultsPanel
            result={viewDetail.resultData as SuiteExecutionResult}
            allSteps={[]}
            targetStepId={null}
            onClose={() => { setViewDrawer(null); setViewDetail(null) }}
          />
        ) : (
          <div style={{ color: '#888', textAlign: 'center', padding: 40 }}>
            No result data available for this run.
          </div>
        )}
      </Drawer>
    </div>
  )
}
