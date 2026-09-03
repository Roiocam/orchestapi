import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import 'cronstrue/locales/zh_CN'
import type { TFunction } from 'i18next'
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
import { formatDateTime } from '../utils/datetime'

const { Text } = Typography
const { RangePicker } = DatePicker

function columnLabel(dataIndex: string, t: TFunction): string {
  if (dataIndex === 'suiteName') return t('pages.runs.columnSuiteName')
  if (dataIndex === 'scopeName') return t('pages.runs.columnScope')
  if (dataIndex === 'environmentName') return t('pages.runs.columnEnvironment')
  return dataIndex
}

function getCronstrueLocale(language: string): string {
  return language.startsWith('zh') ? 'zh_CN' : 'en'
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
  const { t } = useTranslation()
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
        placeholder={t('common.searchColumn', { column: columnLabel(dataIndex, t) })}
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
          {t('common.search')}
        </Button>
        <Button
          size="small"
          onClick={() => {
            setLocalValue('')
            onReset(dataIndex)
            close()
          }}
        >
          {t('common.reset')}
        </Button>
        <Button type="link" size="small" onClick={() => close()}>
          {t('common.close')}
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
  const { t, i18n } = useTranslation()
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
  const [viewLoading, setViewLoading] = useState(false)
  const [liveResult, setLiveResult] = useState<SuiteExecutionResult | null>(null)
  const runStreamRef = useRef<(() => void) | null>(null)

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
  const [batchAppliedFilters, setBatchAppliedFilters] = useState<Record<string, string>>({})
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
  const [scheduleEnvironmentFilter, setScheduleEnvironmentFilter] = useState<string | undefined>(undefined)
  const [scheduleProjectFilter, setScheduleProjectFilter] = useState<string | undefined>(undefined)
  const [scheduleCollectionFilter, setScheduleCollectionFilter] = useState<string | undefined>(undefined)
  const [scheduleSuiteFilter, setScheduleSuiteFilter] = useState<string | undefined>(undefined)
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

  useEffect(() => {
    return () => {
      runStreamRef.current?.()
      runStreamRef.current = null
    }
  }, [])

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
        if (appliedFilters.environmentName) params.environmentName = appliedFilters.environmentName
        if (triggerFilter) params.triggerType = triggerFilter
        if (dateRange && dateRange[0]) params.from = dateRange[0].startOf('day').toISOString()
        if (dateRange && dateRange[1]) params.to = dateRange[1].endOf('day').toISOString()

        const result = await runApi.list(params)
        if (!cancelled) setData(result)
      } catch {
        if (!cancelled) message.error(t('pages.runs.failedLoadRuns'))
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
          scopeName: batchAppliedFilters.scopeName,
          environmentName: batchAppliedFilters.environmentName,
          triggerType: batchTriggerFilter,
          status: batchStatusFilter,
          from: batchDateRange?.[0]?.startOf('day').toISOString(),
          to: batchDateRange?.[1]?.endOf('day').toISOString(),
        })
        if (!cancelled) setBatchData(result)
      } catch {
        if (!cancelled) message.error(t('pages.runs.failedLoadBatches'))
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
    batchAppliedFilters,
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
          environmentId: scheduleEnvironmentFilter,
          projectId: scheduleProjectFilter,
          collectionId: scheduleCollectionFilter,
          suiteId: scheduleSuiteFilter,
        })
        if (!cancelled) setScheduleData(result)
      } catch {
        if (!cancelled) message.error(t('pages.runs.failedLoadSchedules'))
      } finally {
        if (!cancelled) setScheduleLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [
    schedulePage,
    schedulePageSize,
    scheduleRefreshKey,
    activeTab,
    scheduleEnvironmentFilter,
    scheduleProjectFilter,
    scheduleCollectionFilter,
    scheduleSuiteFilter,
  ])

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
        if (!cancelled) message.error(t('pages.runs.failedLoadNotifyLogs'))
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
      message.error(t('pages.runs.failedLoadDropdownOptions'))
    }
  }, [])

  useEffect(() => {
    if (activeTab !== 'schedules' && activeTab !== 'notifications') return
    loadDropdownOptions()
  }, [activeTab, loadDropdownOptions])

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

  // ──── Batches: filter handlers ────
  const handleApplyBatchFilter = (dataIndex: string, value: string) => {
    setBatchAppliedFilters((prev) => ({ ...prev, [dataIndex]: value }))
    setBatchPage(1)
  }

  const handleResetBatchFilter = (dataIndex: string) => {
    setBatchAppliedFilters((prev) => {
      const next = { ...prev }
      delete next[dataIndex]
      return next
    })
    setBatchPage(1)
  }

  const handleClearAllBatchFilters = () => {
    setBatchAppliedFilters({})
    setBatchTriggerFilter(undefined)
    setBatchStatusFilter(undefined)
    setBatchDateRange(null)
    setBatchPage(1)
  }

  const handleViewRun = async (id: string) => {
    runStreamRef.current?.()
    runStreamRef.current = null
    setViewDrawer(id)
    setViewLoading(true)
    setLiveResult(null)
    try {
      const detail = await runApi.get(id)
      if (detail.status === 'RUNNING') {
        setLiveResult({ status: 'RUNNING', steps: [], totalDurationMs: 0 })
        let receivedStep = false
        runStreamRef.current = runApi.stream(id, {
          onStep: (step) => {
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
              message.error(error || t('pages.runs.failedStreamRun'))
            }
          },
        })
      } else if (detail.resultData) {
        setLiveResult(detail.resultData as SuiteExecutionResult)
      }
    } catch {
      message.error(t('pages.runs.failedLoadRunDetails'))
      setViewDrawer(null)
    } finally {
      setViewLoading(false)
    }
  }

  const closeRunDrawer = () => {
    runStreamRef.current?.()
    runStreamRef.current = null
    setViewDrawer(null)
    setLiveResult(null)
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
      message.error(t('pages.runs.failedExportRun'))
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
      message.error(t('pages.runs.failedExportBatch'))
    }
  }

  const handleViewBatch = (id: string) => {
    navigate(`/runs/batches/${id}`)
  }

  const handleDeleteRun = async (id: string) => {
    try {
      await runApi.delete(id)
      message.success(t('pages.runs.runDeleted'))
      setRefreshKey((k) => k + 1)
    } catch {
      message.error(t('pages.runs.failedDeleteRun'))
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
      message.error(t('pages.runs.failedToggleSchedule'))
      setScheduleRefreshKey((k) => k + 1) // revert by refetching
    }
  }

  const handleRunNow = async (id: string) => {
    setRunningNowIds((prev) => new Set(prev).add(id))
    try {
      await scheduleApi.runNow(id)
      message.success(t('pages.runs.scheduleRunStarted'))
      setScheduleRefreshKey((k) => k + 1)
      setNotifyLogRefreshKey((k) => k + 1)
      setRefreshKey((k) => k + 1)
      setBatchRefreshKey((k) => k + 1)
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        message.error(axiosErr.response?.data?.error ?? t('pages.runs.failedStartSchedule'))
      } else {
        message.error(t('pages.runs.failedStartSchedule'))
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
      message.success(t('pages.runs.scheduleDeleted'))
      setScheduleRefreshKey((k) => k + 1)
    } catch {
      message.error(t('pages.runs.failedDeleteSchedule'))
    }
  }

  const handleClearScheduleFilters = () => {
    setScheduleEnvironmentFilter(undefined)
    setScheduleProjectFilter(undefined)
    setScheduleCollectionFilter(undefined)
    setScheduleSuiteFilter(undefined)
    setSchedulePage(1)
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
            message.error(t('pages.runs.extraLabelsMustBeObject'))
            return
          }
          notifyExtraLabels = {}
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            notifyExtraLabels[k] = v == null ? '' : String(v)
          }
        } catch {
          message.error(t('pages.runs.extraLabelsInvalidJson'))
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
        message.success(t('pages.runs.scheduleUpdated'))
      } else {
        await scheduleApi.create(payload)
        message.success(t('pages.runs.scheduleCreated'))
      }
      setScheduleModalOpen(false)
      setScheduleRefreshKey((k) => k + 1)
    } catch (err) {
      // Validation errors are handled by the form; only show API errors
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        message.error(axiosErr.response?.data?.error || t('pages.runs.failedSaveSchedule'))
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

  const batchColumnSearchProps = (dataIndex: string) => ({
    filterDropdown: (props: FilterDropdownProps) => (
      <ColumnSearch
        dataIndex={dataIndex}
        filterDropdownProps={props}
        appliedValue={batchAppliedFilters[dataIndex] ?? ''}
        onApply={handleApplyBatchFilter}
        onReset={handleResetBatchFilter}
      />
    ),
    filterIcon: () => (
      <SearchOutlined style={{ color: batchAppliedFilters[dataIndex] ? '#1677ff' : undefined }} />
    ),
    filtered: !!batchAppliedFilters[dataIndex],
  })

  // ──── Active filter entries (column search + trigger + date) ────
  const activeFilterEntries = Object.entries(appliedFilters).filter(([, v]) => v)
  const hasAdditionalFilters = !!triggerFilter || (dateRange && (dateRange[0] || dateRange[1]))
  const hasAnyFilter = activeFilterEntries.length > 0 || hasAdditionalFilters

  const batchActiveFilterEntries = Object.entries(batchAppliedFilters).filter(([, v]) => v)
  const hasBatchAdditionalFilters =
    !!batchTriggerFilter || !!batchStatusFilter || (batchDateRange && (batchDateRange[0] || batchDateRange[1]))
  const hasAnyBatchFilter = batchActiveFilterEntries.length > 0 || hasBatchAdditionalFilters

  // ──── Cron readable text helper ────
  // cronstrue expects 5-field (standard) or 6-field (with seconds) cron.
  // We accept both formats — normalize for display.
  let cronReadable: { text: string; error: boolean } = { text: '', error: false }
  if (cronValue.trim()) {
    try {
      cronReadable = {
        text: cronstrue.toString(cronValue.trim(), { locale: getCronstrueLocale(i18n.language) }),
        error: false,
      }
    } catch {
      cronReadable = { text: t('pages.runs.invalidCronExpression'), error: true }
    }
  }

  // ──── Run History columns ────
  const runColumns = [
    {
      title: t('common.sno'),
      key: 'sno',
      width: 60,
      render: (_: unknown, __: TestRunResponse, index: number) => (
        <span style={{ color: '#888' }}>{(currentPage - 1) * pageSize + index + 1}</span>
      ),
    },
    {
      title: t('pages.runs.columnSuiteName'),
      dataIndex: 'suiteName',
      key: 'suiteName',
      ...columnSearchProps('suiteName'),
      render: (name: string) => <strong>{name}</strong>,
    },
    {
      title: t('pages.runs.columnEnvironment'),
      dataIndex: 'environmentName',
      key: 'environmentName',
      ...columnSearchProps('environmentName'),
    },
    {
      title: t('pages.runs.columnStatus'),
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (status: TestRunResponse['status']) => (
        <Tag color={STATUS_TAG_COLOR[status] ?? 'default'}>{translateStatus(status, t)}</Tag>
      ),
    },
    {
      title: t('pages.runs.columnTrigger'),
      dataIndex: 'triggerType',
      key: 'triggerType',
      width: 100,
      render: (trigger: TestRunResponse['triggerType']) => (
        <Tag color={TRIGGER_TAG_COLOR[trigger] ?? 'default'}>{translateTrigger(trigger, t)}</Tag>
      ),
    },
    {
      title: t('pages.runs.columnDuration'),
      dataIndex: 'totalDurationMs',
      key: 'totalDurationMs',
      width: 100,
      sorter: true,
      sortOrder: sortBy === 'totalDurationMs' ? (sortDir === 'asc' ? ('ascend' as const) : ('descend' as const)) : null,
      render: (ms: number) => (ms != null ? formatDuration(ms) : '\u2014'),
    },
    {
      title: t('pages.runs.columnStartedAt'),
      dataIndex: 'startedAt',
      key: 'startedAt',
      width: 170,
      sorter: true,
      sortOrder: sortBy === 'startedAt' ? (sortDir === 'asc' ? ('ascend' as const) : ('descend' as const)) : null,
      render: (v: string | null) => formatDateTime(v),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 120,
      render: (_: unknown, record: TestRunResponse) => (
        <Space>
          <Tooltip title={t('common.view')}>
            <Button
              type="text"
              icon={<EyeOutlined />}
              onClick={() => handleViewRun(record.id)}
            />
          </Tooltip>
          <Tooltip title={t('common.export')}>
            <Button
              type="text"
              icon={<DownloadOutlined />}
              onClick={() => handleExportRun(record.id)}
            />
          </Tooltip>
          <Popconfirm
            title={t('pages.runs.deleteRunConfirm')}
            onConfirm={() => handleDeleteRun(record.id)}
            okText={t('common.delete')}
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
      title: t('common.sno'),
      key: 'sno',
      width: 60,
      render: (_: unknown, __: BatchRunResponse, index: number) => (
        <span style={{ color: '#888' }}>{(batchPage - 1) * batchPageSize + index + 1}</span>
      ),
    },
    {
      title: t('pages.runs.columnScope'),
      key: 'scope',
      dataIndex: 'scopeName',
      ...batchColumnSearchProps('scopeName'),
      render: (_: unknown, record: BatchRunResponse) => (
        <Space size={6} wrap>
          <Tag>{translateScope(record.scopeType, t)}</Tag>
          <strong>{record.scopeName}</strong>
        </Space>
      ),
    },
    {
      title: t('pages.runs.columnEnvironment'),
      dataIndex: 'environmentName',
      key: 'environmentName',
      ...batchColumnSearchProps('environmentName'),
      render: (name: string | null) => name || '\u2014',
    },
    {
      title: t('pages.runs.columnTrigger'),
      dataIndex: 'triggerType',
      key: 'triggerType',
      width: 100,
      render: (trigger: BatchRunResponse['triggerType']) => (
        <Tag color={TRIGGER_TAG_COLOR[trigger] ?? 'default'}>{translateTrigger(trigger, t)}</Tag>
      ),
    },
    {
      title: t('pages.runs.columnStatus'),
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (status: BatchRunResponse['status']) => (
        <Tag color={STATUS_TAG_COLOR[status] ?? 'default'}>{translateStatus(status, t)}</Tag>
      ),
    },
    {
      title: t('pages.runs.columnSuites'),
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
      title: t('pages.runs.columnDuration'),
      dataIndex: 'totalDurationMs',
      key: 'totalDurationMs',
      width: 100,
      render: (ms: number | null) => (ms != null ? formatDuration(ms) : '\u2014'),
    },
    {
      title: t('pages.runs.columnStartedAt'),
      dataIndex: 'startedAt',
      key: 'startedAt',
      width: 170,
      sorter: true,
      sortOrder: batchSortBy === 'startedAt'
        ? (batchSortDir === 'asc' ? ('ascend' as const) : ('descend' as const))
        : null,
      render: (v: string | null) => formatDateTime(v),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 100,
      render: (_: unknown, record: BatchRunResponse) => (
        <Space>
          <Tooltip title={t('common.view')}>
            <Button
              type="text"
              icon={<EyeOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                handleViewBatch(record.id)
              }}
            />
          </Tooltip>
          <Tooltip title={t('common.export')}>
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
      title: t('common.sno'),
      key: 'sno',
      width: 60,
      render: (_: unknown, __: RunScheduleResponse, index: number) => (
        <span style={{ color: '#888' }}>{(schedulePage - 1) * schedulePageSize + index + 1}</span>
      ),
    },
    {
      title: t('pages.runs.columnTarget'),
      key: 'target',
      render: (_: unknown, record: RunScheduleResponse) => (
        <Space size={6} wrap>
          <Tag>{translateScope(record.scopeType ?? 'SUITE', t)}</Tag>
          <strong>{record.scopeName ?? record.suiteName ?? '—'}</strong>
          {typeof record.suiteCount === 'number' && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('pages.runs.suitesCount', { count: record.suiteCount })}
            </Text>
          )}
          {record.notifyEnabled && <Tag color="cyan">{t('pages.runs.notifyTag')}</Tag>}
        </Space>
      ),
    },
    {
      title: t('pages.runs.columnEnvironment'),
      dataIndex: 'environmentName',
      key: 'environmentName',
    },
    {
      title: t('pages.runs.columnCron'),
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
      title: t('pages.runs.columnDescription'),
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (text: string | null) => text || '\u2014',
    },
    {
      title: t('pages.runs.columnNextRun'),
      dataIndex: 'nextRunAt',
      key: 'nextRunAt',
      width: 170,
      render: (v: string | null) => formatDateTime(v),
    },
    {
      title: t('pages.runs.columnLastRun'),
      dataIndex: 'lastRunAt',
      key: 'lastRunAt',
      width: 170,
      render: (v: string | null) => formatDateTime(v, t('common.never')),
    },
    {
      title: t('pages.runs.columnActive'),
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
      title: t('common.actions'),
      key: 'actions',
      width: 140,
      render: (_: unknown, record: RunScheduleResponse) => (
        <Space>
          <Tooltip title={t('pages.runs.runNow')}>
            <Button
              type="text"
              icon={<PlayCircleOutlined />}
              loading={runningNowIds.has(record.id)}
              onClick={() => handleRunNow(record.id)}
            />
          </Tooltip>
          <Tooltip title={t('common.edit')}>
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => openScheduleModal(record)}
            />
          </Tooltip>
          <Popconfirm
            title={t('pages.runs.deleteScheduleConfirm')}
            onConfirm={() => handleDeleteSchedule(record.id)}
            okText={t('common.delete')}
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
          <div className="page-header-kicker">{t('pages.runs.kicker')}</div>
          <h1 className="page-header-title">{t('pages.runs.title')}</h1>
          <p className="page-header-desc">
            {t('pages.runs.description')}
          </p>
        </div>
      </div>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'history',
            label: t('pages.runs.tabRunHistory'),
            children: (
              <div>
                {/* Additional filters row */}
                <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <Select
                    placeholder={t('pages.runs.filterTriggerType')}
                    value={triggerFilter}
                    onChange={(val) => { setTriggerFilter(val || undefined); setCurrentPage(1) }}
                    allowClear
                    style={{ width: 150 }}
                    size="small"
                    options={[
                      { value: 'MANUAL', label: t('pages.runs.triggerManual') },
                      { value: 'SCHEDULED', label: t('pages.runs.triggerScheduled') },
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
                    <span style={{ color: '#888', fontSize: 13 }}>{t('common.filters')}</span>
                    {activeFilterEntries.map(([key, value]) => (
                      <Tag
                        key={key}
                        closable
                        onClose={() => handleResetFilter(key)}
                        color="blue"
                        style={{ fontSize: 13 }}
                      >
                        {columnLabel(key, t)}: {value}
                      </Tag>
                    ))}
                    {triggerFilter && (
                      <Tag
                        closable
                        onClose={() => { setTriggerFilter(undefined); setCurrentPage(1) }}
                        color="blue"
                        style={{ fontSize: 13 }}
                      >
                        {t('pages.runs.filterTrigger', { value: translateTrigger(triggerFilter, t) })}
                      </Tag>
                    )}
                    {dateRange && dateRange[0] && dateRange[1] && (
                      <Tag
                        closable
                        onClose={() => { setDateRange(null); setCurrentPage(1) }}
                        color="blue"
                        style={{ fontSize: 13 }}
                      >
                        {t('pages.runs.filterDate', {
                          from: dateRange[0].format('YYYY-MM-DD'),
                          to: dateRange[1].format('YYYY-MM-DD'),
                        })}
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
                        {t('common.clearAll')}
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
                    showTotal: (total, range) => t('common.pagination', { from: range[0], to: range[1], total }),
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
            label: t('pages.runs.tabBatches'),
            children: (
              <div>
                <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <Select
                    placeholder={t('pages.runs.filterTriggerType')}
                    value={batchTriggerFilter}
                    onChange={(val) => { setBatchTriggerFilter(val || undefined); setBatchPage(1) }}
                    allowClear
                    style={{ width: 150 }}
                    size="small"
                    options={[
                      { value: 'MANUAL', label: t('pages.runs.triggerManual') },
                      { value: 'SCHEDULED', label: t('pages.runs.triggerScheduled') },
                    ]}
                  />
                  <Select
                    placeholder={t('pages.runs.filterStatus')}
                    value={batchStatusFilter}
                    onChange={(val) => { setBatchStatusFilter(val || undefined); setBatchPage(1) }}
                    allowClear
                    style={{ width: 160 }}
                    size="small"
                    options={[
                      { value: 'RUNNING', label: t('pages.runs.statusRunning') },
                      { value: 'SUCCESS', label: t('pages.runs.statusSuccess') },
                      { value: 'PARTIAL_FAILURE', label: t('pages.runs.statusPartialFailure') },
                      { value: 'FAILURE', label: t('pages.runs.statusFailure') },
                      { value: 'CANCELLED', label: t('pages.runs.statusCancelled') },
                    ]}
                  />
                  <RangePicker
                    size="small"
                    value={batchDateRange as [Dayjs, Dayjs] | null}
                    onChange={(dates) => { setBatchDateRange(dates); setBatchPage(1) }}
                    style={{ width: 260 }}
                  />
                </div>

                {hasAnyBatchFilter && (
                  <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: '#888', fontSize: 13 }}>{t('common.filters')}</span>
                    {batchActiveFilterEntries.map(([key, value]) => (
                      <Tag
                        key={key}
                        closable
                        onClose={() => handleResetBatchFilter(key)}
                        color="blue"
                        style={{ fontSize: 13 }}
                      >
                        {columnLabel(key, t)}: {value}
                      </Tag>
                    ))}
                    {batchTriggerFilter && (
                      <Tag
                        closable
                        onClose={() => { setBatchTriggerFilter(undefined); setBatchPage(1) }}
                        color="blue"
                        style={{ fontSize: 13 }}
                      >
                        {t('pages.runs.filterTrigger', { value: translateTrigger(batchTriggerFilter, t) })}
                      </Tag>
                    )}
                    {batchStatusFilter && (
                      <Tag
                        closable
                        onClose={() => { setBatchStatusFilter(undefined); setBatchPage(1) }}
                        color="blue"
                        style={{ fontSize: 13 }}
                      >
                        {t('pages.runs.filterStatusTag', {
                          value: translateStatus(batchStatusFilter, t),
                        })}
                      </Tag>
                    )}
                    {batchDateRange && batchDateRange[0] && batchDateRange[1] && (
                      <Tag
                        closable
                        onClose={() => { setBatchDateRange(null); setBatchPage(1) }}
                        color="blue"
                        style={{ fontSize: 13 }}
                      >
                        {t('pages.runs.filterDate', {
                          from: batchDateRange[0].format('YYYY-MM-DD'),
                          to: batchDateRange[1].format('YYYY-MM-DD'),
                        })}
                      </Tag>
                    )}
                    {(batchActiveFilterEntries.length
                      + (batchTriggerFilter ? 1 : 0)
                      + (batchStatusFilter ? 1 : 0)
                      + (batchDateRange && batchDateRange[0] ? 1 : 0)) > 1 && (
                      <Button
                        type="link"
                        size="small"
                        icon={<CloseCircleFilled />}
                        onClick={handleClearAllBatchFilters}
                        style={{ fontSize: 12, padding: 0 }}
                      >
                        {t('common.clearAll')}
                      </Button>
                    )}
                  </div>
                )}

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
                    showTotal: (total, range) => t('common.pagination', { from: range[0], to: range[1], total }),
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
            label: t('pages.runs.tabSchedules'),
            children: (
              <div>
                <div style={{ marginBottom: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Select
                    allowClear
                    showSearch
                    placeholder={t('pages.runs.filterEnvironment')}
                    style={{ width: 220 }}
                    value={scheduleEnvironmentFilter}
                    onChange={(v) => {
                      setScheduleEnvironmentFilter(v)
                      setSchedulePage(1)
                    }}
                    optionFilterProp="label"
                    options={envOptions}
                  />
                  <Select
                    allowClear
                    showSearch
                    placeholder={t('pages.runs.filterProject')}
                    style={{ width: 220 }}
                    value={scheduleProjectFilter}
                    onChange={(v) => {
                      setScheduleProjectFilter(v)
                      setSchedulePage(1)
                    }}
                    optionFilterProp="label"
                    options={projectOptions}
                  />
                  <Select
                    allowClear
                    showSearch
                    placeholder={t('pages.runs.filterCollection')}
                    style={{ width: 220 }}
                    value={scheduleCollectionFilter}
                    onChange={(v) => {
                      setScheduleCollectionFilter(v)
                      setSchedulePage(1)
                    }}
                    optionFilterProp="label"
                    options={collectionOptions}
                  />
                  <Select
                    allowClear
                    showSearch
                    placeholder={t('pages.runs.filterSuite')}
                    style={{ width: 220 }}
                    value={scheduleSuiteFilter}
                    onChange={(v) => {
                      setScheduleSuiteFilter(v)
                      setSchedulePage(1)
                    }}
                    optionFilterProp="label"
                    options={suiteOptions}
                  />
                  {(scheduleEnvironmentFilter || scheduleProjectFilter || scheduleCollectionFilter || scheduleSuiteFilter) && (
                    <Button onClick={handleClearScheduleFilters}>{t('common.clearAll')}</Button>
                  )}
                  <div style={{ marginLeft: 'auto' }}>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => openScheduleModal()}
                  >
                    {t('pages.runs.createSchedule')}
                  </Button>
                  </div>
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
                    showTotal: (total, range) => t('common.pagination', { from: range[0], to: range[1], total }),
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
            label: t('pages.runs.tabNotifications'),
            children: (
              <div>
                <div style={{ marginBottom: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <Select
                    allowClear
                    placeholder={t('pages.runs.filterByResult')}
                    style={{ width: 160 }}
                    value={notifyLogSuccessFilter}
                    onChange={(v) => {
                      setNotifyLogSuccessFilter(v)
                      setNotifyLogPage(1)
                    }}
                    options={[
                      { value: true, label: t('pages.runs.statusSuccess') },
                      { value: false, label: t('pages.runs.statusFailure') },
                    ]}
                  />
                  <Select
                    allowClear
                    showSearch
                    placeholder={t('pages.runs.filterBySchedule')}
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
                  <Button onClick={() => setNotifyLogRefreshKey((k) => k + 1)}>{t('common.refresh')}</Button>
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
                      title: t('pages.runs.columnTime'),
                      dataIndex: 'createdAt',
                      width: 180,
                      render: (v: string) => formatDateTime(v),
                    },
                    {
                      title: t('pages.runs.columnResult'),
                      dataIndex: 'success',
                      width: 100,
                      render: (ok: boolean) => (
                        <Tag color={ok ? 'success' : 'error'}>
                          {ok ? t('pages.runs.notifyResultSuccess') : t('pages.runs.notifyResultFailed')}
                        </Tag>
                      ),
                    },
                    {
                      title: t('pages.runs.columnHttp'),
                      dataIndex: 'httpStatus',
                      width: 80,
                      render: (v: number | null) => v ?? '—',
                    },
                    {
                      title: t('pages.runs.columnRunStatus'),
                      dataIndex: 'runStatus',
                      width: 140,
                      render: (v: string | null) => v ?? '—',
                    },
                    {
                      title: t('pages.runs.columnEvent'),
                      dataIndex: 'eventName',
                      ellipsis: true,
                      render: (v: string | null) => v ?? '—',
                    },
                    {
                      title: t('pages.runs.columnUrl'),
                      dataIndex: 'notifyUrl',
                      ellipsis: true,
                    },
                    {
                      title: t('pages.runs.columnDuration'),
                      dataIndex: 'durationMs',
                      width: 100,
                      render: (v: number) => t('pages.runs.durationMs', { value: v }),
                    },
                  ]}
                  pagination={{
                    current: notifyLogPage,
                    pageSize: notifyLogPageSize,
                    total: notifyLogData.totalElements,
                    showSizeChanger: true,
                    pageSizeOptions: ['10', '20', '50'],
                    showTotal: (total, range) => t('common.pagination', { from: range[0], to: range[1], total }),
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
        title={t('pages.runs.notifyDeliveryTitle')}
        open={!!notifyLogDrawer}
        onClose={() => setNotifyLogDrawer(null)}
        width={720}
        destroyOnClose
      >
        {notifyLogDrawer && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <Tag color={notifyLogDrawer.success ? 'success' : 'error'}>
                {notifyLogDrawer.success ? t('pages.runs.notifyResultSuccess') : t('pages.runs.notifyResultFailed')}
              </Tag>
              {notifyLogDrawer.httpStatus != null && <Tag>HTTP {notifyLogDrawer.httpStatus}</Tag>}
              {notifyLogDrawer.runStatus && <Tag>{notifyLogDrawer.runStatus}</Tag>}
            </div>
            <div><Text type="secondary">{t('pages.runs.columnTime')}</Text><div>{formatDateTime(notifyLogDrawer.createdAt)}</div></div>
            <div><Text type="secondary">{t('pages.runs.columnUrl')}</Text><div style={{ wordBreak: 'break-all' }}>{notifyLogDrawer.notifyUrl}</div></div>
            <div><Text type="secondary">{t('pages.runs.columnEvent')}</Text><div>{notifyLogDrawer.eventName ?? '—'} / {notifyLogDrawer.eventId ?? '—'}</div></div>
            <div><Text type="secondary">{t('pages.runs.businessId')}</Text><div>{notifyLogDrawer.businessId ?? '—'}</div></div>
            <div><Text type="secondary">{t('pages.runs.columnDuration')}</Text><div>{t('pages.runs.durationMs', { value: notifyLogDrawer.durationMs })}</div></div>
            {notifyLogDrawer.errorMessage && (
              <div>
                <Text type="secondary">{t('pages.runs.error')}</Text>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', background: '#fff1f0', padding: 8, borderRadius: 6 }}>
                  {notifyLogDrawer.errorMessage}
                </pre>
              </div>
            )}
            <div>
              <Text type="secondary">{t('pages.runs.requestBody')}</Text>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', background: '#f8fafc', padding: 8, borderRadius: 6, maxHeight: 280, overflow: 'auto' }}>
                {notifyLogDrawer.requestBody ?? '—'}
              </pre>
            </div>
            <div>
              <Text type="secondary">{t('pages.runs.responseBody')}</Text>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', background: '#f8fafc', padding: 8, borderRadius: 6, maxHeight: 280, overflow: 'auto' }}>
                {notifyLogDrawer.responseBody ?? '—'}
              </pre>
            </div>
          </div>
        )}
      </Drawer>

      {/* View Run Drawer */}
      <Drawer
        title={t('pages.runs.runDetailsTitle')}
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
            {t('pages.runs.noResultData')}
          </div>
        )}
      </Drawer>

      {/* Schedule Modal */}
      <Modal
        title={editingSchedule ? t('pages.runs.editSchedule') : t('pages.runs.createSchedule')}
        open={scheduleModalOpen}
        onOk={handleScheduleSubmit}
        onCancel={() => { setScheduleModalOpen(false); setEditingSchedule(null) }}
        okText={editingSchedule ? t('common.update') : t('common.create')}
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
            label={t('pages.runs.scope')}
            rules={[{ required: true, message: t('pages.runs.pleaseSelectScope') }]}
            extra={t('pages.runs.scopeExtra')}
          >
            <Segmented
              block
              options={[
                { label: t('pages.runs.scopeSUITE'), value: 'SUITE' },
                { label: t('pages.runs.scopeCOLLECTION'), value: 'COLLECTION' },
                { label: t('pages.runs.scopePROJECT'), value: 'PROJECT' },
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
                ? t('pages.runs.scopePROJECT')
                : scheduleScopeType === 'COLLECTION'
                  ? t('pages.runs.scopeCOLLECTION')
                  : t('pages.runs.scopeSUITE')
            }
            rules={[{ required: true, message: t('pages.runs.pleaseSelectTarget') }]}
          >
            <Select
              placeholder={
                scheduleScopeType === 'PROJECT'
                  ? t('pages.runs.selectProject')
                  : scheduleScopeType === 'COLLECTION'
                    ? t('pages.runs.selectCollection')
                    : t('pages.runs.selectTestSuite')
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
            label={t('pages.runs.columnEnvironment')}
            rules={[{ required: true, message: t('pages.runs.pleaseSelectEnvironment') }]}
          >
            <Select
              placeholder={t('pages.runs.selectEnvironment')}
              showSearch
              filterOption={(input, option) =>
                (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={envOptions}
            />
          </Form.Item>

          <Form.Item
            name="cronExpression"
            label={t('pages.runs.cronExpression')}
            rules={[{ required: true, message: t('pages.runs.pleaseEnterCron') }]}
            extra={
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('pages.runs.cronHelp')}
              </Text>
            }
          >
            <Input
              placeholder={t('pages.runs.cronPlaceholder')}
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
                  <Spin size="small" /> <Text type="secondary" style={{ fontSize: 11 }}>{t('pages.runs.loadingPreview')}</Text>
                </div>
              )}
              {!cronPreviewLoading && cronPreview && cronPreview.valid && cronPreview.nextFireTimes.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {cronPreview.timezone
                      ? t('pages.runs.nextFireTimes', { timezone: cronPreview.timezone })
                      : t('pages.runs.nextFireTimesNoTz')}
                  </Text>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 11, color: '#595959' }}>
                    {cronPreview.nextFireTimes.map((fireTime, i) => (
                      <li key={i}>{formatDateTime(fireTime)}</li>
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
            label={t('common.description')}
          >
            <Input placeholder={t('pages.runs.optionalDescription')} />
          </Form.Item>

          <Form.Item
            name="notifyEnabled"
            label={t('pages.runs.notifyExternalEngine')}
            valuePropName="checked"
            extra={t('pages.runs.notifyExternalEngineExtra')}
          >
            <Switch />
          </Form.Item>

          {notifyEnabled && (
            <>
              <Form.Item
                name="notifyUrl"
                label={t('pages.runs.notifyUrl')}
                rules={[{ required: true, message: t('pages.runs.notifyUrlRequired') }]}
              >
                <Input placeholder="https://notify-engine.example/api/events" />
              </Form.Item>
              <Form.Item
                name="notifyOn"
                label={t('pages.runs.notifyWhen')}
                rules={[{ required: true }]}
              >
                <Segmented
                  options={[
                    { label: t('pages.runs.notifyOnFailure'), value: 'ON_FAILURE' },
                    { label: t('pages.runs.notifyAlways'), value: 'ALWAYS' },
                  ]}
                />
              </Form.Item>
              <div className="form-grid-2">
                <Form.Item
                  name="notifyEventName"
                  label={t('pages.runs.eventName')}
                  extra={t('pages.runs.eventNameExtra')}
                >
                  <Input placeholder="orchestapi.schedule.run" />
                </Form.Item>
                <Form.Item
                  name="notifyBusinessId"
                  label={t('pages.runs.businessId')}
                  extra={t('pages.runs.businessIdExtra')}
                >
                  <Input placeholder={t('pages.runs.optionalOverride')} />
                </Form.Item>
                <Form.Item
                  name="notifyOperator"
                  label={t('pages.runs.operator')}
                  extra={t('pages.runs.operatorExtra')}
                >
                  <Input placeholder="orchestapi" />
                </Form.Item>
              </div>
              <Form.Item
                name="notifyExtraLabelsText"
                label={t('pages.runs.extraLabels')}
                extra={t('pages.runs.extraLabelsExtra')}
              >
                <Input.TextArea
                  rows={4}
                  placeholder={t('pages.runs.extraLabelsPlaceholder')}
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
