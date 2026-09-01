import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Card,
  Form,
  Input,
  Button,
  Space,
  Select,
  Tag,
  Popconfirm,
  Typography,
  message,
  Spin,
  Modal,
  Segmented,
} from 'antd'
import {
  ArrowLeftOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  SaveOutlined,
  PlayCircleOutlined,
  CaretRightOutlined,
  ImportOutlined,
  SettingOutlined,
  CopyOutlined,
  ClockCircleOutlined,
  HolderOutlined,
  SearchOutlined,
  ApartmentOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import type { TestStep, TestStepRequest, HttpMethodType } from '../types/testSuite'
import { testSuiteApi, testStepApi } from '../services/testSuiteApi'
import type { StepExecutionResult, SuiteExecutionResult } from '../services/testSuiteApi'
import { environmentApi } from '../services/environmentApi'
import { scheduleApi } from '../services/scheduleApi'
import type { ConnectorType, HeaderDto } from '../types/environment'
import StepEditor from '../components/StepEditor'
import RunResultsPanel from '../components/RunResultsPanel'
import ImportStepModal from '../components/ImportStepModal'
import ManualInputModal from '../components/ManualInputModal'
import DagView from '../components/DagView'
import { useProjectContext } from '../context/ProjectContext'

const { Title } = Typography

const METHOD_COLORS: Record<HttpMethodType, string> = {
  GET: '#52c41a',
  POST: '#1677ff',
  PUT: '#fa8c16',
  DELETE: '#ff4d4f',
  PATCH: '#722ed1',
}

/** Resolve the full execution chain for a step (topological order) */
function resolveChain(targetId: string, allSteps: TestStep[]): TestStep[] {
  const map = new Map(allSteps.map((s) => [s.id, s]))
  const visited = new Set<string>()
  const order: TestStep[] = []

  const visit = (id: string) => {
    if (visited.has(id)) return
    visited.add(id)
    const step = map.get(id)
    if (!step) return
    for (const dep of step.dependencies) {
      visit(dep.dependsOnStepId)
    }
    order.push(step)
  }

  visit(targetId)
  return order
}

export default function TestSuiteDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [form] = Form.useForm()
  const isNew = id === 'new'
  const { collections, effectiveCollectionId, projectId, bumpSuiteTree, refreshCollections } = useProjectContext()

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [steps, setSteps] = useState<TestStep[]>([])
  const [environments, setEnvironments] = useState<{ label: string; value: string }[]>([])
  const [expandedStepIds, setExpandedStepIds] = useState<Set<string>>(new Set())
  const [stepSearch, setStepSearch] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'dag'>('list')
  const [draggedStepId, setDraggedStepId] = useState<string | null>(null)
  const [dragOverStepId, setDragOverStepId] = useState<string | null>(null)
  const [suiteName, setSuiteName] = useState('')
  const [metaOpen, setMetaOpen] = useState(isNew)
  const [envVarNames, setEnvVarNames] = useState<string[]>([])
  const [connectorNames, setConnectorNames] = useState<{ name: string; type: ConnectorType }[]>([])
  const [fileKeys, setFileKeys] = useState<string[]>([])
  const [envHeaders, setEnvHeaders] = useState<HeaderDto[]>([])

  // Import state
  const [importModalOpen, setImportModalOpen] = useState(false)

  // Run state
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<SuiteExecutionResult | null>(null)
  const [runModalOpen, setRunModalOpen] = useState(false)
  const [runTarget, setRunTarget] = useState<string | null>(null) // null=all, stepId=specific
  const [selectedEnvId, setSelectedEnvId] = useState<string | undefined>(undefined)
  const runResultsRef = useRef<HTMLDivElement>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [inputModalOpen, setInputModalOpen] = useState(false)
  const [inputStepName, setInputStepName] = useState('')
  const [inputFields, setInputFields] = useState<{ name: string; defaultValue: string | null; cachedValue?: string | null }[]>([])

  // Schedule state
  const [activeScheduleCount, setActiveScheduleCount] = useState(0)

  const loadEnvVars = async (envId: string) => {
    try {
      const env = await environmentApi.get(envId)
      setEnvVarNames(env.variables.map((v) => v.key))
      setEnvHeaders(env.headers ?? [])
      setConnectorNames(env.connectors?.map((c) => ({ name: c.name, type: c.type })) ?? [])
      // Load file keys for ${FILE:key} autocomplete
      try {
        const files = await environmentApi.listFiles(envId)
        setFileKeys(files.map((f) => f.fileKey))
      } catch {
        setFileKeys([])
      }
    } catch {
      // non-critical — autocomplete just won't have env var suggestions
    }
  }

  useEffect(() => {
    let cancelled = false

    const loadEnvironments = async () => {
      try {
        const page = await environmentApi.list({ page: 0, size: 100 })
        if (cancelled) return
        setEnvironments(page.content.map((env) => ({ label: env.name, value: env.id })))
      } catch {
        if (!cancelled) message.error(t('pages.testSuiteDetail.failedLoadEnvironments'))
      }
    }

    const loadSuite = async () => {
      if (isNew || !id) return
      setLoading(true)
      try {
        const [suite, stepsData] = await Promise.all([
          testSuiteApi.get(id),
          testStepApi.list(id),
        ])
        if (cancelled) return
        form.setFieldsValue({
          name: suite.name,
          description: suite.description,
          collectionId: suite.collectionId,
          defaultEnvironmentId: suite.defaultEnvironmentId ?? undefined,
        })
        setSuiteName(suite.name)
        setSteps(stepsData)
        // Load env variable names for autocomplete
        if (suite.defaultEnvironmentId) {
          loadEnvVars(suite.defaultEnvironmentId)
        }
      } catch {
        if (cancelled) return
        message.error(t('pages.testSuiteDetail.failedLoad'))
        navigate('/test-suites')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    const loadSchedules = async () => {
      if (isNew || !id) return
      try {
        const schedules = await scheduleApi.getBySuite(id)
        if (!cancelled) setActiveScheduleCount(schedules.filter((s) => s.active).length)
      } catch {
        // non-critical
      }
    }

    loadEnvironments()
    loadSuite()
    loadSchedules()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew])

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)

      const request = {
        name: values.name,
        description: values.description ?? '',
        collectionId: values.collectionId ?? effectiveCollectionId ?? null,
        defaultEnvironmentId: values.defaultEnvironmentId ?? null,
      }

      if (isNew) {
        const created = await testSuiteApi.create(request)
        message.success(t('pages.testSuiteDetail.created'))
        bumpSuiteTree()
        await refreshCollections()
        navigate(`/test-suites/${created.id}`, { replace: true })
      } else {
        await testSuiteApi.update(id!, request)
        setSuiteName(request.name)
        setMetaOpen(false)
        message.success(t('pages.testSuiteDetail.updated'))
        bumpSuiteTree()
      }
    } catch (err: unknown) {
      // Ant Design form validation errors have errorFields — just let the form highlight them
      if (err && typeof err === 'object' && 'errorFields' in err) {
        return
      }
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        message.error(axiosErr.response?.data?.error ?? t('common.failedSave'))
      } else {
        message.error(t('common.failedSave'))
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteStep = async (stepId: string) => {
    try {
      await testStepApi.delete(id!, stepId)
      message.success(t('pages.testSuiteDetail.stepDeleted'))
      const refreshed = await testStepApi.list(id!)
      setSteps(refreshed)
      setExpandedStepIds(prev => { const next = new Set(prev); next.delete(stepId); return next })
    } catch {
      message.error(t('pages.testSuiteDetail.failedDeleteStep'))
    }
  }

  const toggleExpand = (stepId: string) => {
    setExpandedStepIds(prev => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })
  }

  const handleStepSave = async () => {
    const scrollY = window.scrollY
    try {
      const refreshed = await testStepApi.list(id!)
      setSteps(refreshed)
    } catch {
      message.error(t('pages.testSuiteDetail.failedRefreshSteps'))
    }
    requestAnimationFrame(() => window.scrollTo(0, scrollY))
  }

  const closeStep = (stepId: string) => {
    setExpandedStepIds(prev => { const next = new Set(prev); next.delete(stepId); return next })
  }

  const handleDuplicateStep = async (step: TestStep) => {
    try {
      const request: TestStepRequest = {
        name: `${step.name}${t('pages.testSuiteDetail.copySuffix')}`,
        method: step.method,
        url: step.url,
        headers: step.headers ?? [],
        bodyType: step.bodyType,
        body: step.body ?? '',
        formDataFields: step.formDataFields ?? [],
        queryParams: step.queryParams ?? [],
        cacheable: step.cacheable,
        cacheTtlSeconds: step.cacheTtlSeconds,
        dependencyOnly: step.dependencyOnly,
        disabledDefaultHeaders: step.disabledDefaultHeaders ?? [],
        oauthMode: step.oauthMode ?? 'INHERIT',
        groupName: step.groupName ?? '',
        dependencies: step.dependencies.map(d => ({
          dependsOnStepId: d.dependsOnStepId,
          useCache: d.useCache,
          reuseManualInput: d.reuseManualInput,
        })),
        responseHandlers: step.responseHandlers.map(h => ({
          matchCode: h.matchCode,
          action: h.action,
          sideEffectStepId: h.sideEffectStepId,
          retryCount: h.retryCount,
          retryDelaySeconds: h.retryDelaySeconds,
          priority: h.priority,
        })),
        extractVariables: step.extractVariables.map(v => ({
          variableName: v.variableName,
          jsonPath: v.jsonPath,
          source: v.source,
        })),
        verifications: step.verifications.map(v => ({
          connectorName: v.connectorName,
          query: v.query,
          timeoutSeconds: v.timeoutSeconds,
          queryTimeoutSeconds: v.queryTimeoutSeconds,
          preListen: v.preListen,
          assertions: v.assertions.map(a => ({
            jsonPath: a.jsonPath,
            operator: a.operator,
            expectedValue: a.expectedValue,
          })),
        })),
        responseValidations: (step.responseValidations ?? []).map(rv => ({
          validationType: rv.validationType,
          headerName: rv.headerName,
          jsonPath: rv.jsonPath,
          operator: rv.operator,
          expectedValue: rv.expectedValue,
          expectedBody: rv.expectedBody,
          matchMode: rv.matchMode,
          expectedType: rv.expectedType,
        })),
      }
      await testStepApi.create(id!, request)
      message.success(t('pages.testSuiteDetail.stepDuplicated'))
      const refreshed = await testStepApi.list(id!)
      setSteps(refreshed)
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        message.error(axiosErr.response?.data?.error ?? t('pages.testSuiteDetail.failedDuplicateStep'))
      } else {
        message.error(t('pages.testSuiteDetail.failedDuplicateStep'))
      }
    }
  }

  const handleDragStart = (e: React.DragEvent, stepId: string) => {
    setDraggedStepId(stepId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', stepId)
  }

  const handleDragOver = (e: React.DragEvent, stepId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverStepId !== stepId) setDragOverStepId(stepId)
  }

  const handleDragEnd = () => {
    setDraggedStepId(null)
    setDragOverStepId(null)
  }

  const handleDrop = async (e: React.DragEvent, targetStepId: string) => {
    e.preventDefault()
    if (!draggedStepId || draggedStepId === targetStepId) {
      handleDragEnd()
      return
    }
    const currentOrder = steps.map(s => s.id)
    const fromIndex = currentOrder.indexOf(draggedStepId)
    const toIndex = currentOrder.indexOf(targetStepId)
    if (fromIndex === -1 || toIndex === -1) { handleDragEnd(); return }
    const newOrder = [...currentOrder]
    newOrder.splice(fromIndex, 1)
    newOrder.splice(toIndex, 0, draggedStepId)
    const stepMap = new Map(steps.map(s => [s.id, s]))
    setSteps(newOrder.map(sid => stepMap.get(sid)!).filter(Boolean))
    handleDragEnd()
    try {
      await testStepApi.reorder(id!, newOrder)
    } catch {
      message.error(t('pages.testSuiteDetail.failedReorder'))
      const refreshed = await testStepApi.list(id!)
      setSteps(refreshed)
    }
  }

  // Group steps by groupName for visual grouping (#49)
  const groupedSteps = useMemo(() => {
    const filtered = stepSearch
      ? steps.filter(s =>
          s.name.toLowerCase().includes(stepSearch.toLowerCase()) ||
          s.url.toLowerCase().includes(stepSearch.toLowerCase())
        )
      : steps
    const groups = new Map<string, TestStep[]>()
    filtered.forEach(s => {
      const group = s.groupName || ''
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group)!.push(s)
    })
    return groups
  }, [steps, stepSearch])

  // Status color for run result badges (#54)
  const stepStatusColor = (status: string) =>
    status === 'SUCCESS' ? 'green'
      : status === 'ERROR' || status === 'FAILURE' ? 'red'
        : status === 'VERIFICATION_FAILED' ? 'purple'
          : 'orange'

  const openRunModal = (stepId: string | null) => {
    setRunTarget(stepId)
    // Pre-select the suite's default environment
    const defaultEnvId = form.getFieldValue('defaultEnvironmentId') as string | undefined
    setSelectedEnvId(defaultEnvId ?? undefined)
    setRunModalOpen(true)
  }

  // Ref to close SSE connection on unmount or new run
  const closeStreamRef = useRef<(() => void) | null>(null)

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      closeStreamRef.current?.()
    }
  }, [])

  const handleRunConfirm = () => {
    setRunModalOpen(false)
    setRunning(true)
    // Start with an empty result so the panel appears immediately
    setRunResult({ status: 'RUNNING', steps: [], totalDurationMs: 0 })

    // Scroll down to results panel after React renders it (skip in DAG view so user can watch live node updates)
    if (viewMode !== 'dag') {
      setTimeout(() => {
        runResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }

    // Close any previous stream
    closeStreamRef.current?.()

    const onStep = (step: StepExecutionResult) => {
      setRunResult((prev) => {
        if (!prev) return prev
        return { ...prev, steps: [...prev.steps, step] }
      })
    }

    const onComplete = (result: SuiteExecutionResult) => {
      setRunResult(result)
      setRunning(false)
      setRunId(null)
      closeStreamRef.current = null
      if (result.status === 'SUCCESS') {
        message.success(t('pages.testSuiteDetail.runCompletedSuccess'))
      } else if (result.status === 'PARTIAL_FAILURE') {
        message.warning(t('pages.testSuiteDetail.runCompletedPartial'))
      } else {
        message.error(t('pages.testSuiteDetail.runFailed'))
      }
    }

    const onError = (error: string) => {
      setRunning(false)
      setRunId(null)
      closeStreamRef.current = null
      message.error(error || t('pages.testSuiteDetail.runFailed'))
    }

    const onRunStarted = (data: { runId: string }) => {
      setRunId(data.runId)
    }

    const onInputRequired = (data: { runId: string; stepId: string; stepName: string; fields: { name: string; defaultValue: string | null; cachedValue?: string | null }[] }) => {
      setInputStepName(data.stepName)
      setInputFields(data.fields)
      setInputModalOpen(true)
    }

    if (runTarget === null) {
      closeStreamRef.current = testSuiteApi.streamRun(id!, selectedEnvId, onStep, onComplete, onError, onRunStarted, onInputRequired)
    } else {
      closeStreamRef.current = testStepApi.streamRun(id!, runTarget, selectedEnvId, onStep, onComplete, onError, onRunStarted, onInputRequired)
    }
  }

  const handleManualInputSubmit = async (values: Record<string, string>) => {
    if (!runId) return
    try {
      await testSuiteApi.submitManualInput(id!, runId, values)
      setInputModalOpen(false)
    } catch {
      message.error(t('pages.testSuiteDetail.failedSubmitInput'))
    }
  }

  const handleManualInputCancel = async () => {
    if (!runId) return
    try {
      await testSuiteApi.cancelRun(id!, runId)
    } catch {
      // ignore — run may already be cancelled
    }
    setInputModalOpen(false)
    setRunning(false)
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div>
      <div className="suite-detail-header">
        <div className="suite-detail-title-wrap">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/test-suites')} />
          <div>
            <div className="page-header-kicker">{isNew ? t('pages.testSuiteDetail.createKicker') : t('pages.testSuiteDetail.kicker')}</div>
            <Title level={4} className="page-header-title" style={{ fontSize: 18 }}>
              {isNew ? t('pages.testSuiteDetail.createTitle') : suiteName || t('pages.testSuiteDetail.defaultTitle')}
            </Title>
          </div>
          {!isNew && (
            <Button
              type="text"
              size="small"
              icon={<SettingOutlined />}
              onClick={() => setMetaOpen((v) => !v)}
              title={t('pages.testSuiteDetail.editSettingsTitle')}
            />
          )}
        </div>
        {!isNew && (
          <Space>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => openRunModal(null)}
              loading={running}
            >
              {t('pages.testSuiteDetail.runSuite')}
            </Button>
            {activeScheduleCount > 0 && (
              <Tag
                icon={<ClockCircleOutlined />}
                color="purple"
                style={{ cursor: 'pointer' }}
                onClick={() => navigate('/runs?tab=schedules')}
              >
                {t('pages.testSuiteDetail.schedule', { count: activeScheduleCount })}
              </Tag>
            )}
          </Space>
        )}
      </div>

      {(isNew || metaOpen) && (
        <div className="product-panel" style={{ marginBottom: 14 }}>
          <div className="product-panel-header">
            <div>
              <div className="product-panel-title">{t('pages.testSuiteDetail.suiteSettingsTitle')}</div>
              <div className="product-panel-subtitle">
                {t('pages.testSuiteDetail.suiteSettingsSubtitle')}
              </div>
            </div>
          </div>
          <div className="product-panel-body">
            <Form form={form} layout="vertical" requiredMark="optional">
              <div className="form-grid-2">
                <Form.Item
                  className="form-span-2"
                  name="name"
                  label={t('common.name')}
                  rules={[{ required: true, message: t('common.nameRequired') }]}
                  extra={t('pages.testSuiteDetail.nameExtra')}
                >
                  <Input placeholder={t('pages.testSuiteDetail.namePlaceholder')} autoFocus={isNew} />
                </Form.Item>
                <Form.Item
                  className="form-span-2"
                  name="description"
                  label={t('common.description')}
                  extra={t('pages.testSuiteDetail.descriptionExtra')}
                >
                  <Input.TextArea
                    rows={2}
                    placeholder={t('pages.testSuiteDetail.descriptionPlaceholder')}
                    autoSize={{ minRows: 2, maxRows: 4 }}
                  />
                </Form.Item>
                <Form.Item
                  name="collectionId"
                  label={t('pages.testSuiteDetail.collection')}
                  rules={[{ required: true, message: t('pages.testSuiteDetail.collectionRequired') }]}
                  initialValue={effectiveCollectionId ?? undefined}
                  extra={t('pages.testSuiteDetail.collectionExtra')}
                >
                  <Select
                    placeholder={projectId ? t('pages.testSuiteDetail.collectionPlaceholder') : t('pages.testSuiteDetail.selectProjectFirst')}
                    options={collections.map((c) => ({ value: c.id, label: c.name }))}
                    disabled={!projectId || collections.length === 0}
                    showSearch
                    optionFilterProp="label"
                  />
                </Form.Item>
                <Form.Item
                  name="defaultEnvironmentId"
                  label={t('pages.testSuiteDetail.defaultEnvironment')}
                  extra={t('pages.testSuiteDetail.defaultEnvironmentExtra')}
                >
                  <Select
                    showSearch
                    allowClear
                    placeholder={t('pages.testSuiteDetail.selectEnvironment')}
                    options={environments}
                    filterOption={(input, option) =>
                      (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                    onChange={(val) => {
                      if (val) loadEnvVars(val)
                      else {
                        setEnvVarNames([])
                        setConnectorNames([])
                        setFileKeys([])
                      }
                    }}
                  />
                </Form.Item>
              </div>
            </Form>
          </div>
          <div className="product-panel-footer">
            {!isNew && <Button onClick={() => setMetaOpen(false)}>{t('common.cancel')}</Button>}
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
              {isNew ? t('pages.testSuiteDetail.createSuite') : t('pages.testSuiteDetail.saveSettings')}
            </Button>
          </div>
        </div>
      )}

      {/* Steps list */}
      {!isNew && (
        <Card
          size="small"
          className="brand-card card-suite"
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{t('pages.testSuiteDetail.stepsTitle')}</span>
              <Segmented
                size="small"
                value={viewMode}
                onChange={v => setViewMode(v as 'list' | 'dag')}
                options={[
                  { value: 'list', icon: <UnorderedListOutlined /> },
                  { value: 'dag', icon: <ApartmentOutlined /> },
                ]}
                style={{ fontWeight: 'normal' }}
              />
              {viewMode === 'list' && (
                <Input
                  placeholder={t('pages.testSuiteDetail.searchSteps')}
                  size="small"
                  allowClear
                  value={stepSearch}
                  onChange={e => setStepSearch(e.target.value)}
                  style={{ width: 180, fontWeight: 'normal' }}
                  prefix={<SearchOutlined style={{ color: '#bbb' }} />}
                />
              )}
            </div>
          }
          extra={
            <Space>
              {steps.length > 0 && (
                <>
                  <Button type="text" size="small" onClick={() => setExpandedStepIds(new Set(steps.map(s => s.id)))}>
                    {t('pages.testSuiteDetail.expandAll')}
                  </Button>
                  <Button type="text" size="small" onClick={() => setExpandedStepIds(new Set())}>
                    {t('pages.testSuiteDetail.collapseAll')}
                  </Button>
                </>
              )}
              <Button size="small" icon={<ImportOutlined />} onClick={() => setImportModalOpen(true)}>
                {t('pages.testSuiteDetail.importCurl')}
              </Button>
              <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => setExpandedStepIds(prev => new Set(prev).add('_new'))}>
                {t('pages.testSuiteDetail.addStep')}
              </Button>
            </Space>
          }
        >
          {viewMode === 'dag' ? (
            <DagView steps={steps} runResult={runResult} running={running} onRunStep={(stepId) => openRunModal(stepId)} onEditStep={(stepId) => { setViewMode('list'); setExpandedStepIds(new Set([stepId])); setTimeout(() => document.getElementById(`step-${stepId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50) }} />
          ) : steps.length === 0 && !expandedStepIds.has('_new') ? (
            <div style={{ textAlign: 'center', color: '#999', padding: 24 }}>
              {t('pages.testSuiteDetail.emptySteps')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from(groupedSteps.entries()).map(([group, groupSteps]) => (
                <div key={group || '__ungrouped'}>
                  {group && (
                    <div style={{ fontWeight: 600, color: '#595959', fontSize: 12, padding: '6px 0 2px', borderBottom: '1px solid #f0f0f0', marginBottom: 4 }}>
                      {group}
                    </div>
                  )}
                  {groupSteps.map((step) => {
                    const stepResult = runResult?.steps.find(r => r.stepId === step.id)
                    return (
                      <Card
                        key={step.id}
                        id={`step-${step.id}`}
                        size="small"
                        hoverable
                        draggable
                        onDragStart={e => handleDragStart(e, step.id)}
                        onDragOver={e => handleDragOver(e, step.id)}
                        onDrop={e => handleDrop(e, step.id)}
                        onDragEnd={handleDragEnd}
                        style={{
                          cursor: 'pointer',
                          border: expandedStepIds.has(step.id)
                            ? '1px solid #1677ff'
                            : dragOverStepId === step.id && draggedStepId !== step.id
                              ? '1px dashed #1677ff'
                              : undefined,
                          opacity: draggedStepId === step.id ? 0.5 : 1,
                          transition: 'border 0.2s, opacity 0.2s',
                          marginBottom: 4,
                        }}
                        styles={{ body: { padding: '8px 12px' } }}
                      >
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                          onClick={() => toggleExpand(step.id)}
                        >
                          {/* Drag handle */}
                          <HolderOutlined
                            style={{ color: '#bbb', cursor: 'grab', fontSize: 14 }}
                            onClick={e => e.stopPropagation()}
                          />

                          {/* Method badge */}
                          <Tag
                            color={METHOD_COLORS[step.method]}
                            style={{ margin: 0, fontWeight: 600, minWidth: 60, textAlign: 'center' }}
                          >
                            {step.method}
                          </Tag>

                          {/* Step name */}
                          <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{step.name}</span>

                          {/* URL */}
                          <span
                            style={{
                              color: '#888',
                              flex: 1,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {step.url}
                          </span>

                          {/* Badges */}
                          {step.dependencies.length > 0 && (
                            <Tag style={{ margin: 0 }}>{t('pages.testSuiteDetail.deps', { count: step.dependencies.length })}</Tag>
                          )}
                          {step.cacheable && (
                            <Tag color="cyan" style={{ margin: 0 }}>{t('pages.testSuiteDetail.cached')}</Tag>
                          )}
                          {step.dependencyOnly && (
                            <Tag color="default" style={{ margin: 0 }}>{t('pages.testSuiteDetail.depOnly')}</Tag>
                          )}
                          {step.groupName && (
                            <Tag color="geekblue" style={{ margin: 0 }}>{step.groupName}</Tag>
                          )}

                          {/* Last run status badge (#54) */}
                          {stepResult && (
                            <Tag color={stepStatusColor(stepResult.status)} style={{ margin: 0 }}>
                              {stepResult.status === 'SUCCESS' ? 'PASS' : stepResult.status}
                            </Tag>
                          )}

                          {/* Actions */}
                          <Space size={4} onClick={(e) => e.stopPropagation()}>
                            <Button
                              type="text"
                              size="small"
                              icon={<CaretRightOutlined />}
                              onClick={() => openRunModal(step.id)}
                              disabled={running}
                              title={t('pages.testSuiteDetail.runThisStep')}
                            />
                            <Button
                              type="text"
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={async () => {
                                try {
                                  const defaultEnvId = form.getFieldValue('defaultEnvironmentId') as string | undefined
                                  const curl = await testStepApi.generateCurl(id!, step.id, defaultEnvId)
                                  navigator.clipboard.writeText(curl)
                                  message.success(t('pages.testSuiteDetail.curlCopied'))
                                } catch {
                                  message.error(t('pages.testSuiteDetail.failedGenerateCurl'))
                                }
                              }}
                              title={t('pages.testSuiteDetail.copyCurl')}
                            />
                            <Button
                              type="text"
                              size="small"
                              onClick={() => handleDuplicateStep(step)}
                              title={t('pages.testSuiteDetail.duplicateStep')}
                              style={{ fontSize: 12, padding: '0 4px' }}
                            >
                              {t('pages.testSuiteDetail.clone')}
                            </Button>
                            <Button
                              type="text"
                              size="small"
                              icon={<EditOutlined />}
                              onClick={() => toggleExpand(step.id)}
                            />
                            <Popconfirm
                              title={t('pages.testSuiteDetail.deleteStepConfirm')}
                              onConfirm={() => handleDeleteStep(step.id)}
                              okType="danger"
                            >
                              <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                            </Popconfirm>
                          </Space>
                        </div>

                        {/* Expanded section */}
                        {expandedStepIds.has(step.id) && (
                          <div
                            style={{
                              marginTop: 12,
                              padding: 12,
                              background: '#fafafa',
                              borderRadius: 4,
                            }}
                          >
                            <StepEditor
                              step={step}
                              suiteId={id!}
                              allSteps={steps}
                              envVarNames={envVarNames}
                              envHeaders={envHeaders}
                              connectorNames={connectorNames}
                              fileKeys={fileKeys}
                              onSave={handleStepSave}
                              onCancel={() => closeStep(step.id)}
                            />
                          </div>
                        )}
                      </Card>
                    )
                  })}
                </div>
              ))}

              {/* New step editor */}
              {expandedStepIds.has('_new') && (
                <Card
                  size="small"
                  style={{ border: '1px solid #1677ff' }}
                  styles={{ body: { padding: '12px' } }}
                >
                  <StepEditor
                    step={null}
                    suiteId={id!}
                    allSteps={steps}
                    envVarNames={envVarNames}
                    connectorNames={connectorNames}
                    fileKeys={fileKeys}
                    onSave={handleStepSave}
                    onCancel={() => closeStep('_new')}
                  />
                </Card>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Run results — hidden during streaming in DAG view so user can watch live node updates */}
      <div ref={runResultsRef}>
        {runResult && !(viewMode === 'dag' && running) && (
          <RunResultsPanel result={runResult} allSteps={steps} targetStepId={runTarget} onClose={() => setRunResult(null)} />
        )}
      </div>

      {/* Import step modal */}
      {!isNew && id && (
        <ImportStepModal
          open={importModalOpen}
          suiteId={id}
          onSuccess={async () => {
            setImportModalOpen(false)
            message.success(t('pages.testSuiteDetail.stepImported'))
            try {
              const refreshed = await testStepApi.list(id)
              setSteps(refreshed)
            } catch {
              message.error(t('pages.testSuiteDetail.failedRefreshSteps'))
            }
          }}
          onCancel={() => setImportModalOpen(false)}
        />
      )}

      {/* Run confirmation modal */}
      <Modal
        title={runTarget === null ? t('pages.testSuiteDetail.runSuiteModal') : t('pages.testSuiteDetail.runStepModal')}
        open={runModalOpen}
        onOk={handleRunConfirm}
        onCancel={() => setRunModalOpen(false)}
        okText={t('common.run')}
        okButtonProps={{ icon: <PlayCircleOutlined /> }}
      >
        {/* Execution chain preview */}
        {runTarget === null ? (
          <div className="form-hint" style={{ marginTop: 0 }}>
            <Trans
              i18nKey="pages.testSuiteDetail.runAllSteps"
              values={{ count: steps.length }}
              components={{ strong: <strong /> }}
            />
          </div>
        ) : (() => {
          const chain = resolveChain(runTarget, steps)
          const targetStep = steps.find((s) => s.id === runTarget)
          return (
            <div style={{ marginBottom: 14 }}>
              <div className="form-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                <Trans
                  i18nKey="pages.testSuiteDetail.runStepPrefix"
                  values={{ name: targetStep?.name }}
                  components={{ strong: <strong /> }}
                />
                {chain.length > 1 && (
                  <Trans
                    i18nKey={chain.length - 1 === 1 ? 'pages.testSuiteDetail.runStepWithDeps_one' : 'pages.testSuiteDetail.runStepWithDeps_other'}
                    values={{ count: chain.length - 1 }}
                    components={{ strong: <strong /> }}
                  />
                )}
              </div>
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 4,
                padding: '10px 12px',
                background: '#f8fafc',
                borderRadius: 8,
                border: '1px solid var(--border-color)',
              }}>
                {chain.map((step, i) => (
                  <span key={step.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {i > 0 && <span style={{ color: '#bbb', margin: '0 2px' }}>&rarr;</span>}
                    <Tag
                      color={METHOD_COLORS[step.method]}
                      style={{ margin: 0, fontSize: 11, lineHeight: '18px', padding: '0 4px' }}
                    >
                      {step.method}
                    </Tag>
                    <span style={{
                      fontWeight: step.id === runTarget ? 600 : 400,
                      color: step.id === runTarget ? 'var(--accent)' : '#475569',
                      fontSize: 12,
                    }}>
                      {step.name}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )
        })()}

        <Form layout="vertical" requiredMark="optional">
          <Form.Item
            label={t('components.runCollection.environment')}
            extra={t('components.runCollection.environmentExtra')}
            style={{ marginBottom: 8 }}
          >
            <Select
              showSearch
              allowClear
              placeholder={t('components.runCollection.environmentPlaceholder')}
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
      </Modal>

      <ManualInputModal
        open={inputModalOpen}
        stepName={inputStepName}
        fields={inputFields}
        onSubmit={handleManualInputSubmit}
        onCancel={handleManualInputCancel}
      />
    </div>
  )
}
