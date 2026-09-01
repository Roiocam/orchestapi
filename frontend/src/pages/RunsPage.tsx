import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Table,
  Button,
  Space,
  Popconfirm,
  Tag,
  message,
  Typography,
  Tooltip,
  Input,
  Select,
  DatePicker,
  Tabs,
  Drawer,
  Switch,
  Modal,
  Form,
  Spin,
  Segmented,
} from 'antd'
import type { InputRef } from 'antd'
import {
  EyeOutlined,
  DownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
  CloseCircleFilled,
  PlayCircleOutlined,
} from '@ant-design/icons'
import type { FilterDropdownProps } from 'antd/es/table/interface'
import type { Dayjs } from 'dayjs'
import cronstrue from 'cronstrue'
import type { PageResponse } from '../types/environment'
import type { TestRunResponse, RunScheduleResponse, RunScheduleRequest, CronPreviewResponse, RunListParams, ScheduleNotifyLogResponse } from '../types/run'
import type { BatchRunResponse } from '../types/batch'
import type { SuiteExecutionResult } from '../services/testSuiteApi'
import { runApi } from '../services/runApi'
import { batchApi } from '../services/batchApi'
import { scheduleApi } from '../services/scheduleApi'
import { testSuiteApi } from '../services/testSuiteApi'
import { environmentApi } from '../services/environmentApi'
import { projectApi, collectionApi } from '../services/projectApi'
import RunResultsPanel from '../components/RunResultsPanel'

const { Text } = Typography
const { RangePicker } = DatePicker

const COLUMN_LABELS: Record<string, string> = {
  suiteName: 'Suite Name',
  environmentName: 'Environment',
}

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

// ────────────────── Column Search (shared) ──────────────────
function ColumnSearch({
  dataIndex,
  filterDropdownProps,
  appliedValue,
  onApply,
  onReset,
}: {
  dataIndex: string
  filterDropdownProps: FilterDropdownProps
  appliedValue: string
  onApply: (dataIndex: string, value: string) => void
  onReset: (dataIndex: string) => void
}) {
  const [localValue, setLocalValue] = useState(appliedValue)
  const inputRef = useRef<InputRef>(null)
  const { close } = filterDropdownProps

  useEffect(() => {
    if (filterDropdownProps.visible) {
      setLocalValue(appliedValue)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [filterDropdownProps.visible, appliedValue])

  return (
    <div style={{ padding: 8 }} onKeyDown={(e) => e.stopPropagation()}>
      <Input
        ref={inputRef}
        placeholder={`Search ${COLUMN_LABELS[dataIndex] ?? dataIndex}`}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onPressEnter={() => {
          onApply(dataIndex, localValue)
          close()
        }}
        style={{ marginBottom: 8, display: 'block' }}
        size="small"
      />
      <Space>
        <Button
          type="primary"
          icon={<SearchOutlined />}
          size="small"
          onClick={() => {
            onApply(dataIndex, localValue)
            close()
          }}
        >
          Search
        </Button>
        <Button
          size="small"
          onClick={() => {
            setLocalValue('')
            onReset(dataIndex)
            close()
          }}
        >
          Reset
        </Button>
        <Button type="link" size="small" onClick={() => close()}>
          Close
        </Button>
      </Space>
    </div>
  )
}

// ────────────────── format helpers ──────────────────
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// ────────────────── Main Component ──────────────────
export default function RunsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') ?? 'history'
  const legacyBatchId = searchParams.get('batchId')

  const setActiveTab = useCallback((tab: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('tab', tab)
      next.delete('batchId')
      return next
    }, { replace: true })
  }, [setSearchParams])

  // Redirect legacy ?batchId= deep links to the dedicated detail page
  useEffect(() => {
    if (legacyBatchId) {
      navigate(`/runs/batches/${legacyBatchId}`, { replace: true })
    }
  }, [legacyBatchId, navigate])

  // ──── Run History state ────
  const [data, setData] = useState<PageResponse<TestRunResponse>>({
    content: [],
    page: 0,
    size: 10,
    totalElements: 0,
    totalPages: 0,
  })
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [sortBy, setSortBy] = useState('startedAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [appliedFilters, setAppliedFilters] = useState<Record<string, string>>({})
  const [refreshKey, setRefreshKey] = useState(0)

  // Additional filters
  const [triggerFilter, setTriggerFilter] = useState<string | undefined>(undefined)
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)

  // View drawer
  const [viewDrawer, setViewDrawer] = useState<string | null>(null)
  const [viewDetail, setViewDetail] = useState<TestRunResponse | null>(null)
  const [viewLoading, setViewLoading] = useState(false)

  // ──── Batches state ────
  const [batchData, setBatchData] = useState<PageResponse<BatchRunResponse>>({
    content: [],
    page: 0,
    size: 10,
    totalElements: 0,
    totalPages: 0,
  })
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchPage, setBatchPage] = useState(1)
  const [batchPageSize, setBatchPageSize] = useState(10)
  const [batchSortBy, setBatchSortBy] = useState('startedAt')
  const [batchSortDir, setBatchSortDir] = useState<'asc' | 'desc'>('desc')
  const [batchTriggerFilter, setBatchTriggerFilter] = useState<string | undefined>(undefined)
  const [batchStatusFilter, setBatchStatusFilter] = useState<string | undefined>(undefined)
  const [batchDateRange, setBatchDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [batchRefreshKey, setBatchRefreshKey] = useState(0)

  // ──── Schedules state ────
  const [scheduleData, setScheduleData] = useState<PageResponse<RunScheduleResponse>>({
    content: [],
    page: 0,
    size: 10,
    totalElements: 0,
    totalPages: 0,
  })
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [schedulePage, setSchedulePage] = useState(1)
  const [schedulePageSize, setSchedulePageSize] = useState(10)
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0)
  const [runningNowIds, setRunningNowIds] = useState<Set<string>>(new Set())

  // Notify logs
  const [notifyLogData, setNotifyLogData] = useState<PageResponse<ScheduleNotifyLogResponse>>({
    content: [],
    page: 0,
    size: 10,
    totalElements: 0,
    totalPages: 0,
  })
  const [notifyLogLoading, setNotifyLogLoading] = useState(false)
  const [notifyLogPage, setNotifyLogPage] = useState(1)
  const [notifyLogPageSize, setNotifyLogPageSize] = useState(10)
  const [notifyLogSuccessFilter, setNotifyLogSuccessFilter] = useState<boolean | undefined>(undefined)
  const [notifyLogScheduleFilter, setNotifyLogScheduleFilter] = useState<string | undefined>(undefined)
  const [notifyLogRefreshKey, setNotifyLogRefreshKey] = useState(0)
  const [notifyLogDrawer, setNotifyLogDrawer] = useState<ScheduleNotifyLogResponse | null>(null)

  // Schedule modal
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<RunScheduleResponse | null>(null)
  const [scheduleForm] = Form.useForm()
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false)
  const watchedScopeType = Form.useWatch('scopeType', scheduleForm) as 'SUITE' | 'COLLECTION' | 'PROJECT' | undefined
  const scheduleScopeType = watchedScopeType ?? 'SUITE'
  const notifyEnabled = Form.useWatch('notifyEnabled', scheduleForm) as boolean | undefined

  // Dropdown options for schedule modal
  const [suiteOptions, setSuiteOptions] = useState<{ value: string; label: string }[]>([])
  const [collectionOptions, setCollectionOptions] = useState<{ value: string; label: string }[]>([])
  const [projectOptions, setProjectOptions] = useState<{ value: string; label: string }[]>([])
  const [envOptions, setEnvOptions] = useState<{ value: string; label: string }[]>([])

  // Cron preview
  const [cronValue, setCronValue] = useState('')
  const [cronPreview, setCronPreview] = useState<CronPreviewResponse | null>(null)
  const [cronPreviewLoading, setCronPreviewLoading] = useState(false)
  const cronDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ──── Run History: data fetch ────
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const params: RunListParams = {
          page: currentPage - 1,
          size: pageSize,
          sortBy,
          sortDir,
        }
        if (appliedFilters.suiteName) params.suiteName = appliedFilters.suiteName
        if (triggerFilter) params.triggerType = triggerFilter
        if (dateRange && dateRange[0]) params.from = dateRange[0].startOf('day').toISOString()
        if (dateRange && dateRange[1]) params.to = dateRange[1].endOf('day').toISOString()

        const result = await runApi.list(params)
        if (!cancelled) setData(result)
      } catch {
        if (!cancelled) message.error('Failed to load runs')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [currentPage, pageSize, sortBy, sortDir, appliedFilters, refreshKey, triggerFilter, dateRange])

  // ──── Batches: data fetch ────
  useEffect(() => {
    if (activeTab !== 'batches') return
    let cancelled = false
    const load = async () => {
      setBatchLoading(true)
      try {
        const result = await batchApi.list({
          page: batchPage - 1,
          size: batchPageSize,
          sortBy: batchSortBy,
          sortDir: batchSortDir,
          triggerType: batchTriggerFilter,
          status: batchStatusFilter,
          from: batchDateRange?.[0]?.startOf('day').toISOString(),
          to: batchDateRange?.[1]?.endOf('day').toISOString(),
        })
        if (!cancelled) setBatchData(result)
      } catch {
        if (!cancelled) message.error('Failed to load batches')
      } finally {
        if (!cancelled) setBatchLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [
    activeTab,
    batchPage,
    batchPageSize,
    batchSortBy,
    batchSortDir,
    batchTriggerFilter,
    batchStatusFilter,
    batchDateRange,
    batchRefreshKey,
  ])

  // ──── Schedules: data fetch ────
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setScheduleLoading(true)
      try {
        const result = await scheduleApi.list({
          page: activeTab === 'notifications' ? 0 : schedulePage - 1,
          size: activeTab === 'notifications' ? 200 : schedulePageSize,
        })
        if (!cancelled) setScheduleData(result)
      } catch {
        if (!cancelled) message.error('Failed to load schedules')
      } finally {
        if (!cancelled) setScheduleLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [schedulePage, schedulePageSize, scheduleRefreshKey, activeTab])

  // ──── Notify logs: data fetch ────
  useEffect(() => {
    if (activeTab !== 'notifications') return
    let cancelled = false
    const load = async () => {
      setNotifyLogLoading(true)
      try {
        const result = await scheduleApi.listNotifyLogs({
          page: notifyLogPage - 1,
          size: notifyLogPageSize,
          scheduleId: notifyLogScheduleFilter,
          success: notifyLogSuccessFilter,
        })
        if (!cancelled) setNotifyLogData(result)
      } catch {
        if (!cancelled) message.error('Failed to load notify logs')
      } finally {
        if (!cancelled) setNotifyLogLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [
    activeTab,
    notifyLogPage,
    notifyLogPageSize,
    notifyLogSuccessFilter,
    notifyLogScheduleFilter,
    notifyLogRefreshKey,
  ])

  // ──── Load dropdown options for schedule modal ────
  const loadDropdownOptions = useCallback(async () => {
    try {
      const [suitesRes, collections, projects, envsRes] = await Promise.all([
        testSuiteApi.list({ size: 1000 }),
        collectionApi.list(),
        projectApi.list(),
        environmentApi.list({ size: 1000 }),
      ])
      setSuiteOptions(suitesRes.content.map((s) => ({ value: s.id, label: s.name })))
      setCollectionOptions(collections.map((c) => ({ value: c.id, label: c.name })))
      setProjectOptions(projects.map((p) => ({ value: p.id, label: p.name })))
      setEnvOptions(envsRes.content.map((e) => ({ value: e.id, label: e.name })))
    } catch {
      message.error('Failed to load dropdown options')
    }
  }, [])

  // ──── Run History: handlers ────
  const handleApplyFilter = (dataIndex: string, value: string) => {
    setAppliedFilters((prev) => ({ ...prev, [dataIndex]: value }))
    setCurrentPage(1)
  }

  const handleResetFilter = (dataIndex: string) => {
    setAppliedFilters((prev) => {
      const next = { ...prev }
      delete next[dataIndex]
      return next
    })
    setCurrentPage(1)
  }

  const handleClearAllFilters = () => {
    setAppliedFilters({})
    setTriggerFilter(undefined)
    setDateRange(null)
    setCurrentPage(1)
  }

  const handleViewRun = async (id: string) => {
    setViewDrawer(id)
    setViewLoading(true)
    setViewDetail(null)
    try {
      const detail = await runApi.get(id)
      setViewDetail(detail)
    } catch {
      message.error('Failed to load run details')
      setViewDrawer(null)
    } finally {
      setViewLoading(false)
    }
  }

  const handleExportRun = async (id: string) => {
    try {
      const exportData = await runApi.export(id)
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `run-${id}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 100)
    } catch {
      message.error('Failed to export run')
    }
  }

  const handleExportBatch = async (id: string) => {
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

  const handleViewBatch = (id: string) => {
    navigate(`/runs/batches/${id}`)
  }

  const handleDeleteRun = async (id: string) => {
    try {
      await runApi.delete(id)
      message.success('Run deleted')
      setRefreshKey((k) => k + 1)
    } catch {
      message.error('Failed to delete run')
    }
  }

  // ──── Schedule: handlers ────
  const handleToggleSchedule = async (id: string) => {
    // Optimistic update
    setScheduleData((prev) => ({
      ...prev,
      content: prev.content.map((s) =>
        s.id === id ? { ...s, active: !s.active } : s,
      ),
    }))
    try {
      await scheduleApi.toggle(id)
    } catch {
      message.error('Failed to toggle schedule')
      setScheduleRefreshKey((k) => k + 1) // revert by refetching
    }
  }

  const handleRunNow = async (id: string) => {
    setRunningNowIds((prev) => new Set(prev).add(id))
    try {
      await scheduleApi.runNow(id)
      message.success('Schedule run started')
      setScheduleRefreshKey((k) => k + 1)
      setNotifyLogRefreshKey((k) => k + 1)
      setRefreshKey((k) => k + 1)
      setBatchRefreshKey((k) => k + 1)
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        message.error(axiosErr.response?.data?.error ?? 'Failed to start schedule')
      } else {
        message.error('Failed to start schedule')
      }
    } finally {
      setRunningNowIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const handleDeleteSchedule = async (id: string) => {
    try {
      await scheduleApi.delete(id)
      message.success('Schedule deleted')
      setScheduleRefreshKey((k) => k + 1)
    } catch {
      message.error('Failed to delete schedule')
    }
  }

  const openScheduleModal = (schedule?: RunScheduleResponse) => {
    setEditingSchedule(schedule ?? null)
    if (schedule) {
      const scopeType = schedule.scopeType ?? 'SUITE'
      const extra = schedule.notifyExtraLabels ?? {}
      scheduleForm.setFieldsValue({
        scopeType,
        scopeId: schedule.scopeId ?? schedule.suiteId,
        environmentId: schedule.environmentId,
        cronExpression: schedule.cronExpression,
        description: schedule.description ?? '',
        notifyEnabled: schedule.notifyEnabled ?? false,
        notifyUrl: schedule.notifyUrl ?? '',
        notifyOn: schedule.notifyOn ?? 'ON_FAILURE',
        notifyEventName: schedule.notifyEventName ?? '',
        notifyBusinessId: schedule.notifyBusinessId ?? '',
        notifyOperator: schedule.notifyOperator ?? '',
        notifyExtraLabelsText: Object.keys(extra).length
          ? JSON.stringify(extra, null, 2)
          : '',
      })
      setCronValue(schedule.cronExpression)
    } else {
      scheduleForm.resetFields()
      scheduleForm.setFieldsValue({
        scopeType: 'SUITE',
        notifyEnabled: false,
        notifyOn: 'ON_FAILURE',
      })
      setCronValue('')
    }
    setCronPreview(null)
    setScheduleModalOpen(true)
    loadDropdownOptions()
  }

  const handleScheduleSubmit = async () => {
    try {
      const values = await scheduleForm.validateFields()
      setScheduleSubmitting(true)

      let notifyExtraLabels: Record<string, string> | undefined
      const rawExtra = (values.notifyExtraLabelsText as string | undefined)?.trim()
      if (rawExtra) {
        try {
          const parsed = JSON.parse(rawExtra) as unknown
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            message.error('Extra labels must be a JSON object of string keys/values')
            return
          }
          notifyExtraLabels = {}
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            notifyExtraLabels[k] = v == null ? '' : String(v)
          }
        } catch {
          message.error('Extra labels must be valid JSON')
          return
        }
      }

      const payload: RunScheduleRequest = {
        scopeType: values.scopeType ?? 'SUITE',
        scopeId: values.scopeId,
        environmentId: values.environmentId,
        cronExpression: values.cronExpression,
        description: values.description || undefined,
        notifyEnabled: Boolean(values.notifyEnabled),
        notifyUrl: values.notifyUrl || undefined,
        notifyOn: values.notifyOn ?? 'ON_FAILURE',
        notifyEventName: values.notifyEventName || undefined,
        notifyBusinessId: values.notifyBusinessId || undefined,
        notifyOperator: values.notifyOperator || undefined,
        notifyExtraLabels,
      }
      if (editingSchedule) {
        await scheduleApi.update(editingSchedule.id, payload)
        message.success('Schedule updated')
      } else {
        await scheduleApi.create(payload)
        message.success('Schedule created')
      }
      setScheduleModalOpen(false)
      setScheduleRefreshKey((k) => k + 1)
    } catch (err) {
      // Validation errors are handled by the form; only show API errors
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        message.error(axiosErr.response?.data?.error || 'Failed to save schedule')
      }
    } finally {
      setScheduleSubmitting(false)
    }
  }

  // ──── Cron preview with debounce ────
  const handleCronChange = (val: string) => {
    setCronValue(val)
    scheduleForm.setFieldsValue({ cronExpression: val })

    if (cronDebounceRef.current) clearTimeout(cronDebounceRef.current)
    if (!val.trim()) {
      setCronPreview(null)
      return
    }
    cronDebounceRef.current = setTimeout(async () => {
      setCronPreviewLoading(true)
      try {
        const preview = await scheduleApi.preview(val)
        setCronPreview(preview)
      } catch {
        setCronPreview(null)
      } finally {
        setCronPreviewLoading(false)
      }
    }, 500)
  }

  // ──── Column search props factory ────
  const columnSearchProps = (dataIndex: string) => ({
    filterDropdown: (props: FilterDropdownProps) => (
      <ColumnSearch
        dataIndex={dataIndex}
        filterDropdownProps={props}
        appliedValue={appliedFilters[dataIndex] ?? ''}
        onApply={handleApplyFilter}
        onReset={handleResetFilter}
      />
    ),
    filterIcon: () => (
      <SearchOutlined style={{ color: appliedFilters[dataIndex] ? '#1677ff' : undefined }} />
    ),
    filtered: !!appliedFilters[dataIndex],
  })

  // ──── Active filter entries (column search + trigger + date) ────
  const activeFilterEntries = Object.entries(appliedFilters).filter(([, v]) => v)
  const hasAdditionalFilters = !!triggerFilter || (dateRange && (dateRange[0] || dateRange[1]))
  const hasAnyFilter = activeFilterEntries.length > 0 || hasAdditionalFilters

  // ──── Cron readable text helper ────
  // cronstrue expects 5-field (standard) or 6-field (with seconds) cron.
  // We accept both formats — normalize for display.
  let cronReadable: { text: string; error: boolean } = { text: '', error: false }
  if (cronValue.trim()) {
    try {
      cronReadable = { text: cronstrue.toString(cronValue.trim()), error: false }
    } catch {
      cronReadable = { text: 'Invalid expression', error: true }
    }
  }

  // ──── Run History columns ────
  const runColumns = [
    {
      title: 'S.No',
      key: 'sno',
      width: 60,
      render: (_: unknown, __: TestRunResponse, index: number) => (
        <span style={{ color: '#888' }}>{(currentPage - 1) * pageSize + index + 1}</span>
      ),
    },
    {
      title: 'Suite Name',
      dataIndex: 'suiteName',
      key: 'suiteName',
      ...columnSearchProps('suiteName'),
      render: (name: string) => <strong>{name}</strong>,
    },
    {
      title: 'Environment',
      dataIndex: 'environmentName',
      key: 'environmentName',
      ...columnSearchProps('environmentName'),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (status: TestRunResponse['status']) => (
        <Tag color={STATUS_TAG_COLOR[status] ?? 'default'}>{status.replace('_', ' ')}</Tag>
      ),
    },
    {
      title: 'Trigger',
      dataIndex: 'triggerType',
      key: 'triggerType',
      width: 100,
      render: (trigger: TestRunResponse['triggerType']) => (
        <Tag color={TRIGGER_TAG_COLOR[trigger] ?? 'default'}>{trigger}</Tag>
      ),
    },
    {
      title: 'Duration',
      dataIndex: 'totalDurationMs',
      key: 'totalDurationMs',
      width: 100,
      sorter: true,
      sortOrder: sortBy === 'totalDurationMs' ? (sortDir === 'asc' ? ('ascend' as const) : ('descend' as const)) : null,
      render: (ms: number) => (ms != null ? formatDuration(ms) : '\u2014'),
    },
    {
      title: 'Started At',
      dataIndex: 'startedAt',
      key: 'startedAt',
      width: 170,
      sorter: true,
      sortOrder: sortBy === 'startedAt' ? (sortDir === 'asc' ? ('ascend' as const) : ('descend' as const)) : null,
      render: (v: string | null) => (v ? new Date(v).toLocaleString() : '\u2014'),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 120,
      render: (_: unknown, record: TestRunResponse) => (
        <Space>
          <Tooltip title="View">
            <Button
              type="text"
              icon={<EyeOutlined />}
              onClick={() => handleViewRun(record.id)}
            />
          </Tooltip>
          <Tooltip title="Export">
            <Button
              type="text"
              icon={<DownloadOutlined />}
              onClick={() => handleExportRun(record.id)}
            />
          </Tooltip>
          <Popconfirm
            title="Delete this run?"
            onConfirm={() => handleDeleteRun(record.id)}
            okText="Delete"
            okType="danger"
          >
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  // ──── Batches columns ────
  const batchColumns = [
    {
      title: 'S.No',
      key: 'sno',
      width: 60,
      render: (_: unknown, __: BatchRunResponse, index: number) => (
        <span style={{ color: '#888' }}>{(batchPage - 1) * batchPageSize + index + 1}</span>
      ),
    },
    {
      title: 'Scope',
      key: 'scope',
      render: (_: unknown, record: BatchRunResponse) => (
        <Space size={6} wrap>
          <Tag>{record.scopeType}</Tag>
          <strong>{record.scopeName}</strong>
        </Space>
      ),
    },
    {
      title: 'Trigger',
      dataIndex: 'triggerType',
      key: 'triggerType',
      width: 100,
      render: (trigger: BatchRunResponse['triggerType']) => (
        <Tag color={TRIGGER_TAG_COLOR[trigger] ?? 'default'}>{trigger}</Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (status: BatchRunResponse['status']) => (
        <Tag color={STATUS_TAG_COLOR[status] ?? 'default'}>{status.replace('_', ' ')}</Tag>
      ),
    },
    {
      title: 'Suites',
      key: 'suites',
      width: 120,
      render: (_: unknown, record: BatchRunResponse) => (
        <span>
          <Text type="success">{record.succeeded}</Text>
          {' / '}
          <Text type="danger">{record.failed}</Text>
          {' / '}
          {record.totalSuites}
        </span>
      ),
    },
    {
      title: 'Started At',
      dataIndex: 'startedAt',
      key: 'startedAt',
      width: 170,
      sorter: true,
      sortOrder: batchSortBy === 'startedAt'
        ? (batchSortDir === 'asc' ? ('ascend' as const) : ('descend' as const))
        : null,
      render: (v: string | null) => (v ? new Date(v).toLocaleString() : '\u2014'),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: BatchRunResponse) => (
        <Space>
          <Tooltip title="View">
            <Button
              type="text"
              icon={<EyeOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                handleViewBatch(record.id)
              }}
            />
          </Tooltip>
          <Tooltip title="Export">
            <Button
              type="text"
              icon={<DownloadOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                handleExportBatch(record.id)
              }}
            />
          </Tooltip>
        </Space>
      ),
    },
  ]

  // ──── Schedules columns ────
  const scheduleColumns = [
    {
      title: 'S.No',
      key: 'sno',
      width: 60,
      render: (_: unknown, __: RunScheduleResponse, index: number) => (
        <span style={{ color: '#888' }}>{(schedulePage - 1) * schedulePageSize + index + 1}</span>
      ),
    },
    {
      title: 'Target',
      key: 'target',
      render: (_: unknown, record: RunScheduleResponse) => (
        <Space size={6} wrap>
          <Tag>{record.scopeType ?? 'SUITE'}</Tag>
          <strong>{record.scopeName ?? record.suiteName ?? '—'}</strong>
          {typeof record.suiteCount === 'number' && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.suiteCount} suite{record.suiteCount === 1 ? '' : 's'}
            </Text>
          )}
          {record.notifyEnabled && <Tag color="cyan">Notify</Tag>}
        </Space>
      ),
    },
    {
      title: 'Environment',
      dataIndex: 'environmentName',
      key: 'environmentName',
    },
    {
      title: 'Cron',
      dataIndex: 'cronExpression',
      key: 'cronExpression',
      width: 160,
      render: (text: string) => (
        <code style={{ fontSize: 12, background: '#f5f5f5', padding: '2px 6px', borderRadius: 3 }}>
          {text}
        </code>
      ),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (text: string | null) => text || '\u2014',
    },
    {
      title: 'Next Run',
      dataIndex: 'nextRunAt',
      key: 'nextRunAt',
      width: 170,
      render: (v: string | null) => (v ? new Date(v).toLocaleString() : '\u2014'),
    },
    {
      title: 'Last Run',
      dataIndex: 'lastRunAt',
      key: 'lastRunAt',
      width: 170,
      render: (v: string | null) => (v ? new Date(v).toLocaleString() : 'Never'),
    },
    {
      title: 'Active',
      key: 'active',
      width: 70,
      render: (_: unknown, record: RunScheduleResponse) => (
        <Switch
          checked={record.active}
          onChange={() => handleToggleSchedule(record.id)}
          size="small"
        />
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 140,
      render: (_: unknown, record: RunScheduleResponse) => (
        <Space>
          <Tooltip title="Run now">
            <Button
              type="text"
              icon={<PlayCircleOutlined />}
              loading={runningNowIds.has(record.id)}
              onClick={() => handleRunNow(record.id)}
            />
          </Tooltip>
          <Tooltip title="Edit">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => openScheduleModal(record)}
            />
          </Tooltip>
          <Popconfirm
            title="Delete this schedule?"
            onConfirm={() => handleDeleteSchedule(record.id)}
            okText="Delete"
            okType="danger"
          >
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  // ──── Render ────
  return (
    <div>
      <div className="page-header">
        <div className="page-header-copy">
          <div className="page-header-kicker">Execution</div>
          <h1 className="page-header-title">Runs</h1>
          <p className="page-header-desc">
            Suite run history, collection/project batches, schedules, and notify delivery logs.
          </p>
        </div>
      </div>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'history',
            label: 'Run History',
            children: (
              <div>
                {/* Additional filters row */}
                <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <Select
                    placeholder="Trigger type"
                    value={triggerFilter}
                    onChange={(val) => { setTriggerFilter(val || undefined); setCurrentPage(1) }}
                    allowClear
                    style={{ width: 150 }}
                    size="small"
                    options={[
                      { value: 'MANUAL', label: 'Manual' },
                      { value: 'SCHEDULED', label: 'Scheduled' },
                    ]}
                  />
                  <RangePicker
                    size="small"
                    value={dateRange as [Dayjs, Dayjs] | null}
                    onChange={(dates) => { setDateRange(dates); setCurrentPage(1) }}
                    style={{ width: 260 }}
                  />
                </div>

                {/* Active filter tags */}
                {hasAnyFilter && (
                  <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: '#888', fontSize: 13 }}>Filters:</span>
                    {activeFilterEntries.map(([key, value]) => (
                      <Tag
                        key={key}
                        closable
                        onClose={() => handleResetFilter(key)}
                        color="blue"
                        style={{ fontSize: 13 }}
                      >
                        {COLUMN_LABELS[key] ?? key}: {value}
                      </Tag>
                    ))}
                    {triggerFilter && (
                      <Tag
                        closable
                        onClose={() => { setTriggerFilter(undefined); setCurrentPage(1) }}
                        color="blue"
                        style={{ fontSize: 13 }}
                      >
                        Trigger: {triggerFilter}
                      </Tag>
                    )}
                    {dateRange && dateRange[0] && dateRange[1] && (
                      <Tag
                        closable
                        onClose={() => { setDateRange(null); setCurrentPage(1) }}
                        color="blue"
                        style={{ fontSize: 13 }}
                      >
                        Date: {dateRange[0].format('YYYY-MM-DD')} to {dateRange[1].format('YYYY-MM-DD')}
                      </Tag>
                    )}
                    {(activeFilterEntries.length + (triggerFilter ? 1 : 0) + (dateRange && dateRange[0] ? 1 : 0)) > 1 && (
                      <Button
                        type="link"
                        size="small"
                        icon={<CloseCircleFilled />}
                        onClick={handleClearAllFilters}
                        style={{ fontSize: 12, padding: 0 }}
                      >
                        Clear all
                      </Button>
                    )}
                  </div>
                )}

                <Table
                  columns={runColumns}
                  dataSource={data.content}
                  rowKey="id"
                  loading={loading}
                  style={{ background: '#fff', borderRadius: 8, padding: '0 0 8px' }}
                  pagination={{
                    current: currentPage,
                    pageSize,
                    total: data.totalElements,
                    showSizeChanger: true,
                    pageSizeOptions: ['10', '20', '50'],
                    showTotal: (total, range) => `${range[0]}-${range[1]} of ${total}`,
                    style: { padding: '0 16px' },
                  }}
                  onChange={(pagination, _filters, sorter) => {
                    setCurrentPage(pagination.current ?? 1)
                    setPageSize(pagination.pageSize ?? 10)
                    if (!Array.isArray(sorter)) {
                      if (sorter.field && sorter.order) {
                        setSortBy(sorter.field as string)
                        setSortDir(sorter.order === 'descend' ? 'desc' : 'asc')
                      } else {
                        setSortBy('startedAt')
                        setSortDir('desc')
                      }
                    }
                  }}
                />
              </div>
            ),
          },
          {
            key: 'batches',
            label: 'Batches',
            children: (
              <div>
                <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <Select
                    placeholder="Trigger type"
                    value={batchTriggerFilter}
                    onChange={(val) => { setBatchTriggerFilter(val || undefined); setBatchPage(1) }}
                    allowClear
                    style={{ width: 150 }}
                    size="small"
                    options={[
                      { value: 'MANUAL', label: 'Manual' },
                      { value: 'SCHEDULED', label: 'Scheduled' },
                    ]}
                  />
                  <Select
                    placeholder="Status"
                    value={batchStatusFilter}
                    onChange={(val) => { setBatchStatusFilter(val || undefined); setBatchPage(1) }}
                    allowClear
                    style={{ width: 160 }}
                    size="small"
                    options={[
                      { value: 'RUNNING', label: 'Running' },
                      { value: 'SUCCESS', label: 'Success' },
                      { value: 'PARTIAL_FAILURE', label: 'Partial Failure' },
                      { value: 'FAILURE', label: 'Failure' },
                      { value: 'CANCELLED', label: 'Cancelled' },
                    ]}
                  />
                  <RangePicker
                    size="small"
                    value={batchDateRange as [Dayjs, Dayjs] | null}
                    onChange={(dates) => { setBatchDateRange(dates); setBatchPage(1) }}
                    style={{ width: 260 }}
                  />
                </div>

                <Table
                  columns={batchColumns}
                  dataSource={batchData.content}
                  rowKey="id"
                  loading={batchLoading}
                  style={{ background: '#fff', borderRadius: 8, padding: '0 0 8px' }}
                  onRow={(record) => ({
                    onClick: () => handleViewBatch(record.id),
                    style: { cursor: 'pointer' },
                  })}
                  pagination={{
                    current: batchPage,
                    pageSize: batchPageSize,
                    total: batchData.totalElements,
                    showSizeChanger: true,
                    pageSizeOptions: ['10', '20', '50'],
                    showTotal: (total, range) => `${range[0]}-${range[1]} of ${total}`,
                    style: { padding: '0 16px' },
                  }}
                  onChange={(pagination, _filters, sorter) => {
                    setBatchPage(pagination.current ?? 1)
                    setBatchPageSize(pagination.pageSize ?? 10)
                    if (!Array.isArray(sorter)) {
                      if (sorter.field && sorter.order) {
                        setBatchSortBy(sorter.field as string)
                        setBatchSortDir(sorter.order === 'descend' ? 'desc' : 'asc')
                      } else {
                        setBatchSortBy('startedAt')
                        setBatchSortDir('desc')
                      }
                    }
                  }}
                />
              </div>
            ),
          },
          {
            key: 'schedules',
            label: 'Schedules',
            children: (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => openScheduleModal()}
                  >
                    Create Schedule
                  </Button>
                </div>

                <Table
                  columns={scheduleColumns}
                  dataSource={scheduleData.content}
                  rowKey="id"
                  loading={scheduleLoading}
                  style={{ background: '#fff', borderRadius: 8, padding: '0 0 8px' }}
                  pagination={{
                    current: schedulePage,
                    pageSize: schedulePageSize,
                    total: scheduleData.totalElements,
                    showSizeChanger: true,
                    pageSizeOptions: ['10', '20', '50'],
                    showTotal: (total, range) => `${range[0]}-${range[1]} of ${total}`,
                    style: { padding: '0 16px' },
                  }}
                  onChange={(pagination) => {
                    setSchedulePage(pagination.current ?? 1)
                    setSchedulePageSize(pagination.pageSize ?? 10)
                  }}
                />
              </div>
            ),
          },
          {
            key: 'notifications',
            label: 'Notifications',
            children: (
              <div>
                <div style={{ marginBottom: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <Select
                    allowClear
                    placeholder="Filter by result"
                    style={{ width: 160 }}
                    value={notifyLogSuccessFilter}
                    onChange={(v) => {
                      setNotifyLogSuccessFilter(v)
                      setNotifyLogPage(1)
                    }}
                    options={[
                      { value: true, label: 'Success' },
                      { value: false, label: 'Failed' },
                    ]}
                  />
                  <Select
                    allowClear
                    showSearch
                    placeholder="Filter by schedule"
                    style={{ width: 260 }}
                    value={notifyLogScheduleFilter}
                    onChange={(v) => {
                      setNotifyLogScheduleFilter(v)
                      setNotifyLogPage(1)
                    }}
                    optionFilterProp="label"
                    options={scheduleData.content.map((s) => ({
                      value: s.id,
                      label: `${s.scopeName ?? s.suiteName ?? s.id} (${s.scopeType})`,
                    }))}
                  />
                  <Button onClick={() => setNotifyLogRefreshKey((k) => k + 1)}>Refresh</Button>
                </div>
                <Table
                  rowKey="id"
                  loading={notifyLogLoading}
                  dataSource={notifyLogData.content}
                  style={{ background: '#fff', borderRadius: 8, padding: '0 0 8px' }}
                  onRow={(record) => ({
                    onClick: () => setNotifyLogDrawer(record),
                    style: { cursor: 'pointer' },
                  })}
                  columns={[
                    {
                      title: 'Time',
                      dataIndex: 'createdAt',
                      width: 180,
                      render: (v: string) => new Date(v).toLocaleString(),
                    },
                    {
                      title: 'Result',
                      dataIndex: 'success',
                      width: 100,
                      render: (ok: boolean) => (
                        <Tag color={ok ? 'success' : 'error'}>{ok ? 'SUCCESS' : 'FAILED'}</Tag>
                      ),
                    },
                    {
                      title: 'HTTP',
                      dataIndex: 'httpStatus',
                      width: 80,
                      render: (v: number | null) => v ?? '—',
                    },
                    {
                      title: 'Run status',
                      dataIndex: 'runStatus',
                      width: 140,
                      render: (v: string | null) => v ?? '—',
                    },
                    {
                      title: 'Event',
                      dataIndex: 'eventName',
                      ellipsis: true,
                      render: (v: string | null) => v ?? '—',
                    },
                    {
                      title: 'URL',
                      dataIndex: 'notifyUrl',
                      ellipsis: true,
                    },
                    {
                      title: 'Duration',
                      dataIndex: 'durationMs',
                      width: 100,
                      render: (v: number) => `${v} ms`,
                    },
                  ]}
                  pagination={{
                    current: notifyLogPage,
                    pageSize: notifyLogPageSize,
                    total: notifyLogData.totalElements,
                    showSizeChanger: true,
                    pageSizeOptions: ['10', '20', '50'],
                    showTotal: (total, range) => `${range[0]}-${range[1]} of ${total}`,
                    style: { padding: '0 16px' },
                  }}
                  onChange={(pagination) => {
                    setNotifyLogPage(pagination.current ?? 1)
                    setNotifyLogPageSize(pagination.pageSize ?? 10)
                  }}
                />
              </div>
            ),
          },
        ]}
      />

      <Drawer
        title="Notify delivery"
        open={!!notifyLogDrawer}
        onClose={() => setNotifyLogDrawer(null)}
        width={720}
        destroyOnClose
      >
        {notifyLogDrawer && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <Tag color={notifyLogDrawer.success ? 'success' : 'error'}>
                {notifyLogDrawer.success ? 'SUCCESS' : 'FAILED'}
              </Tag>
              {notifyLogDrawer.httpStatus != null && <Tag>HTTP {notifyLogDrawer.httpStatus}</Tag>}
              {notifyLogDrawer.runStatus && <Tag>{notifyLogDrawer.runStatus}</Tag>}
            </div>
            <div><Text type="secondary">Time</Text><div>{new Date(notifyLogDrawer.createdAt).toLocaleString()}</div></div>
            <div><Text type="secondary">URL</Text><div style={{ wordBreak: 'break-all' }}>{notifyLogDrawer.notifyUrl}</div></div>
            <div><Text type="secondary">Event</Text><div>{notifyLogDrawer.eventName ?? '—'} / {notifyLogDrawer.eventId ?? '—'}</div></div>
            <div><Text type="secondary">Business ID</Text><div>{notifyLogDrawer.businessId ?? '—'}</div></div>
            <div><Text type="secondary">Duration</Text><div>{notifyLogDrawer.durationMs} ms</div></div>
            {notifyLogDrawer.errorMessage && (
              <div>
                <Text type="secondary">Error</Text>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', background: '#fff1f0', padding: 8, borderRadius: 6 }}>
                  {notifyLogDrawer.errorMessage}
                </pre>
              </div>
            )}
            <div>
              <Text type="secondary">Request body</Text>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', background: '#f8fafc', padding: 8, borderRadius: 6, maxHeight: 280, overflow: 'auto' }}>
                {notifyLogDrawer.requestBody ?? '—'}
              </pre>
            </div>
            <div>
              <Text type="secondary">Response body</Text>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', background: '#f8fafc', padding: 8, borderRadius: 6, maxHeight: 280, overflow: 'auto' }}>
                {notifyLogDrawer.responseBody ?? '—'}
              </pre>
            </div>
          </div>
        )}
      </Drawer>

      {/* View Run Drawer */}
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

      {/* Schedule Modal */}
      <Modal
        title={editingSchedule ? 'Edit Schedule' : 'Create Schedule'}
        open={scheduleModalOpen}
        onOk={handleScheduleSubmit}
        onCancel={() => { setScheduleModalOpen(false); setEditingSchedule(null) }}
        okText={editingSchedule ? 'Update' : 'Create'}
        confirmLoading={scheduleSubmitting}
        destroyOnClose
        width={640}
      >
        <Form
          form={scheduleForm}
          layout="vertical"
          requiredMark="optional"
          style={{ marginTop: 8 }}
          initialValues={{ scopeType: 'SUITE', notifyEnabled: false, notifyOn: 'ON_FAILURE' }}
        >
          <Form.Item
            name="scopeType"
            label="Scope"
            rules={[{ required: true, message: 'Please select a scope' }]}
            extra="Collection and project schedules run every suite under the target, one after another."
          >
            <Segmented
              block
              options={[
                { label: 'Suite', value: 'SUITE' },
                { label: 'Collection', value: 'COLLECTION' },
                { label: 'Project', value: 'PROJECT' },
              ]}
              onChange={() => {
                scheduleForm.setFieldsValue({ scopeId: undefined })
              }}
            />
          </Form.Item>

          <Form.Item
            name="scopeId"
            label={
              scheduleScopeType === 'PROJECT'
                ? 'Project'
                : scheduleScopeType === 'COLLECTION'
                  ? 'Collection'
                  : 'Suite'
            }
            rules={[{ required: true, message: 'Please select a target' }]}
          >
            <Select
              placeholder={
                scheduleScopeType === 'PROJECT'
                  ? 'Select project'
                  : scheduleScopeType === 'COLLECTION'
                    ? 'Select collection'
                    : 'Select test suite'
              }
              showSearch
              filterOption={(input, option) =>
                (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={
                scheduleScopeType === 'PROJECT'
                  ? projectOptions
                  : scheduleScopeType === 'COLLECTION'
                    ? collectionOptions
                    : suiteOptions
              }
            />
          </Form.Item>

          <Form.Item
            name="environmentId"
            label="Environment"
            rules={[{ required: true, message: 'Please select an environment' }]}
          >
            <Select
              placeholder="Select environment"
              showSearch
              filterOption={(input, option) =>
                (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={envOptions}
            />
          </Form.Item>

          <Form.Item
            name="cronExpression"
            label="Cron Expression"
            rules={[{ required: true, message: 'Please enter a cron expression' }]}
            extra={
              <Text type="secondary" style={{ fontSize: 11 }}>
                5-field (min hr day mon dow) or 6-field (sec min hr day mon dow). Examples: */5 * * * * (every 5min) | 0 8 * * * (daily 8am) | 30 9 * * MON-FRI (weekdays 9:30am)
              </Text>
            }
          >
            <Input
              placeholder="e.g. */5 * * * * or 0 0 8 * * *"
              value={cronValue}
              onChange={(e) => handleCronChange(e.target.value)}
            />
          </Form.Item>

          {/* Cron readable description */}
          {cronValue.trim() && (
            <div style={{ marginTop: -12, marginBottom: 16 }}>
              <Text
                style={{
                  fontSize: 12,
                  color: cronReadable.error ? '#ff4d4f' : '#52c41a',
                }}
              >
                {cronReadable.text}
              </Text>

              {/* Server-side preview: next 5 fire times */}
              {cronPreviewLoading && (
                <div style={{ marginTop: 4 }}>
                  <Spin size="small" /> <Text type="secondary" style={{ fontSize: 11 }}>Loading preview...</Text>
                </div>
              )}
              {!cronPreviewLoading && cronPreview && cronPreview.valid && cronPreview.nextFireTimes.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Next fire times:</Text>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 11, color: '#595959' }}>
                    {cronPreview.nextFireTimes.map((t, i) => (
                      <li key={i}>{new Date(t).toLocaleString()}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!cronPreviewLoading && cronPreview && !cronPreview.valid && cronPreview.error && (
                <div style={{ marginTop: 4 }}>
                  <Text type="danger" style={{ fontSize: 11 }}>{cronPreview.error}</Text>
                </div>
              )}
            </div>
          )}

          <Form.Item
            name="description"
            label="Description"
          >
            <Input placeholder="Optional description" />
          </Form.Item>

          <Form.Item
            name="notifyEnabled"
            label="Notify external engine"
            valuePropName="checked"
            extra="POST a fixed event envelope to your notification rules engine after each scheduled run."
          >
            <Switch />
          </Form.Item>

          {notifyEnabled && (
            <>
              <Form.Item
                name="notifyUrl"
                label="Notify URL"
                rules={[{ required: true, message: 'Notify URL is required when enabled' }]}
              >
                <Input placeholder="https://notify-engine.example/api/events" />
              </Form.Item>
              <Form.Item
                name="notifyOn"
                label="Notify when"
                rules={[{ required: true }]}
              >
                <Segmented
                  options={[
                    { label: 'On failure', value: 'ON_FAILURE' },
                    { label: 'Always', value: 'ALWAYS' },
                  ]}
                />
              </Form.Item>
              <div className="form-grid-2">
                <Form.Item
                  name="notifyEventName"
                  label="Event name"
                  extra="Default: orchestapi.schedule.run"
                >
                  <Input placeholder="orchestapi.schedule.run" />
                </Form.Item>
                <Form.Item
                  name="notifyBusinessId"
                  label="Business ID"
                  extra="Default: schedule id"
                >
                  <Input placeholder="Optional override" />
                </Form.Item>
                <Form.Item
                  name="notifyOperator"
                  label="Operator"
                  extra="Default: orchestapi"
                >
                  <Input placeholder="orchestapi" />
                </Form.Item>
              </div>
              <Form.Item
                name="notifyExtraLabelsText"
                label="Extra labels (JSON object)"
                extra='Merged into label without overriding system keys. Example: {"team":"platform","severity":"agent"}'
              >
                <Input.TextArea
                  rows={4}
                  placeholder='{"team":"platform"}'
                  style={{ fontFamily: 'var(--font-code)', fontSize: 12 }}
                />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </div>
  )
}
