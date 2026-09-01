import { useRef, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Tabs,
  Input,
  Select,
  Button,
  Switch,
  InputNumber,
  Table,
  Popconfirm,
  Checkbox,
  Badge,
  message,
} from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import type {
  TestStep,
  TestStepRequest,
  HttpMethodType,
  BodyType,
  OAuthModeType,
  FormDataField,
  KeyValuePair,
  StepDependencyDto,
  StepResponseHandlerDto,
  StepExtractVariableDto,
  ResponseActionType,
  ExtractionSourceType,
  AssertionOperatorType,
  AssertionDto,
  VerificationDto,
  ResponseValidationDto,
  ResponseValidationType,
  ExpectedDataType,
} from '../types/testSuite'
import type { ConnectorType, HeaderDto } from '../types/environment'
import { testStepApi } from '../services/testSuiteApi'
import PlaceholderInput from './PlaceholderInput'
import type { DepStepInfo } from './PlaceholderInput'

// ---- Types ----

interface StepEditorProps {
  step: TestStep | null // null = new step
  suiteId: string
  allSteps: TestStep[] // for dependency picker (exclude self)
  envVarNames: string[] // environment variable names for autocomplete
  envHeaders?: HeaderDto[] // default headers from environment
  connectorNames?: { name: string; type: ConnectorType }[] // available connectors from environment
  fileKeys?: string[] // environment file keys for ${FILE:key} autocomplete
  onSave: () => void // called after successful save to refresh parent
  onCancel: () => void // collapse/cancel
}

type KVRow = KeyValuePair & { _clientId: string }
type DependencyRow = StepDependencyDto & { _clientId: string }
type HandlerRow = StepResponseHandlerDto & { _clientId: string }
type ExtractRow = StepExtractVariableDto & { _clientId: string }
type FormDataRow = FormDataField & { _clientId: string }
type AssertionRow = AssertionDto & { _clientId: string }
type VerificationRow = Omit<VerificationDto, 'assertions'> & { _clientId: string; assertions: AssertionRow[] }
type ResponseValidationRow = ResponseValidationDto & { _clientId: string }

// Kafka query helpers: separate topic/key fields stored as newline-separated query
function parseKafkaQuery(query: string): { topic: string; key: string } {
  let topic = '', key = ''
  const sep = query.includes('\n') ? '\n' : /\s+/
  for (const part of query.trim().split(sep)) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx > 0) {
      const k = trimmed.slice(0, eqIdx).trim()
      const v = trimmed.slice(eqIdx + 1).trim()
      if (k === 'topic') topic = v
      else if (k === 'key') key = v
    }
  }
  return { topic, key }
}

function buildKafkaQuery(topic: string, key: string): string {
  let q = `topic=${topic}`
  if (key.trim()) q += `\nkey=${key}`
  return q
}

const METHOD_OPTIONS: { label: string; value: HttpMethodType; color: string }[] = [
  { label: 'GET', value: 'GET', color: '#52c41a' },
  { label: 'POST', value: 'POST', color: '#1677ff' },
  { label: 'PUT', value: 'PUT', color: '#fa8c16' },
  { label: 'DELETE', value: 'DELETE', color: '#ff4d4f' },
  { label: 'PATCH', value: 'PATCH', color: '#722ed1' },
]

const ACTION_OPTIONS: { label: string; value: ResponseActionType }[] = [
  { label: 'SUCCESS', value: 'SUCCESS' },
  { label: 'ERROR', value: 'ERROR' },
  { label: 'FIRE_SIDE_EFFECT', value: 'FIRE_SIDE_EFFECT' },
  { label: 'RETRY', value: 'RETRY' },
]

// ---- Component ----

export default function StepEditor({ step, suiteId, allSteps, envVarNames, envHeaders = [], connectorNames = [], fileKeys = [], onSave, onCancel }: StepEditorProps) {
  const { t } = useTranslation()
  const clientIdCounter = useRef(1)
  const genClientId = () => `_new_${clientIdCounter.current++}`

  const SOURCE_OPTIONS = useMemo(() => [
    { label: t('components.stepEditor.sourceResponseBody'), value: 'RESPONSE_BODY' as ExtractionSourceType },
    { label: t('components.stepEditor.sourceResponseHeader'), value: 'RESPONSE_HEADER' as ExtractionSourceType },
    { label: t('components.stepEditor.sourceStatusCode'), value: 'STATUS_CODE' as ExtractionSourceType },
    { label: t('components.stepEditor.sourceRequestBody'), value: 'REQUEST_BODY' as ExtractionSourceType },
    { label: t('components.stepEditor.sourceRequestHeader'), value: 'REQUEST_HEADER' as ExtractionSourceType },
    { label: t('components.stepEditor.sourceQueryParam'), value: 'QUERY_PARAM' as ExtractionSourceType },
    { label: t('components.stepEditor.sourceRequestUrl'), value: 'REQUEST_URL' as ExtractionSourceType },
  ], [t])

  const ASSERTION_OPERATOR_OPTIONS = useMemo(() => [
    { label: t('components.stepEditor.opEquals'), value: 'EQUALS' as AssertionOperatorType },
    { label: t('components.stepEditor.opNotEquals'), value: 'NOT_EQUALS' as AssertionOperatorType },
    { label: t('components.stepEditor.opContains'), value: 'CONTAINS' as AssertionOperatorType },
    { label: t('components.stepEditor.opNotContains'), value: 'NOT_CONTAINS' as AssertionOperatorType },
    { label: t('components.stepEditor.opRegex'), value: 'REGEX' as AssertionOperatorType },
    { label: t('components.stepEditor.opGt'), value: 'GT' as AssertionOperatorType },
    { label: t('components.stepEditor.opLt'), value: 'LT' as AssertionOperatorType },
    { label: t('components.stepEditor.opGte'), value: 'GTE' as AssertionOperatorType },
    { label: t('components.stepEditor.opLte'), value: 'LTE' as AssertionOperatorType },
    { label: t('components.stepEditor.opExists'), value: 'EXISTS' as AssertionOperatorType },
    { label: t('components.stepEditor.opNotExists'), value: 'NOT_EXISTS' as AssertionOperatorType },
  ], [t])

  const DATA_TYPE_OPTIONS = useMemo(() => [
    { label: t('components.stepEditor.dataTypeString'), value: 'STRING' as ExpectedDataType },
    { label: t('components.stepEditor.dataTypeNumber'), value: 'NUMBER' as ExpectedDataType },
    { label: t('components.stepEditor.dataTypeBoolean'), value: 'BOOLEAN' as ExpectedDataType },
    { label: t('components.stepEditor.dataTypeArray'), value: 'ARRAY' as ExpectedDataType },
    { label: t('components.stepEditor.dataTypeObject'), value: 'OBJECT' as ExpectedDataType },
    { label: t('components.stepEditor.dataTypeNull'), value: 'NULL' as ExpectedDataType },
  ], [t])

  const isNew = step === null

  // ---- Basic Info state ----
  const [name, setName] = useState(step?.name ?? '')
  const [method, setMethod] = useState<HttpMethodType>(step?.method ?? 'GET')
  const [url, setUrl] = useState(step?.url ?? '')
  const [oauthMode, setOauthMode] = useState<OAuthModeType>(step?.oauthMode ?? 'INHERIT')

  // ---- Headers state ----
  const [headers, setHeaders] = useState<KVRow[]>(
    () => {
      const envHeaderKeys = new Set(envHeaders.map((h) => h.headerKey))
      return (step?.headers ?? [])
        .filter((h) => !envHeaderKeys.has(h.key)) // exclude overrides from step headers list
        .map((h) => ({ ...h, _clientId: genClientId() }))
    },
  )
  const [disabledDefaultHeaders, setDisabledDefaultHeaders] = useState<Set<string>>(
    () => new Set(step?.disabledDefaultHeaders ?? []),
  )
  // Track overridden default header values: headerKey -> overridden value
  const [defaultHeaderOverrides, setDefaultHeaderOverrides] = useState<Record<string, string>>(() => {
    // If step has headers that match env default header keys, treat as overrides
    const overrides: Record<string, string> = {}
    if (step?.headers && envHeaders.length > 0) {
      const envHeaderKeys = new Set(envHeaders.map((h) => h.headerKey))
      step.headers.forEach((h) => {
        if (envHeaderKeys.has(h.key)) {
          overrides[h.key] = h.value
        }
      })
    }
    return overrides
  })

  // ---- Query Params state ----
  const [queryParams, setQueryParams] = useState<KVRow[]>(
    () => step?.queryParams.map((p) => ({ ...p, _clientId: genClientId() })) ?? [],
  )

  // ---- Body state ----
  const [bodyType, setBodyType] = useState<BodyType>(step?.bodyType ?? 'NONE')
  const [body, setBody] = useState(step?.body ?? '')
  const [formDataFields, setFormDataFields] = useState<FormDataRow[]>(
    () => (step?.formDataFields ?? []).map((f) => ({ ...f, _clientId: genClientId() })),
  )
  const [jsonError, setJsonError] = useState<string | null>(null)

  // ---- Dependencies state ----
  const [dependencies, setDependencies] = useState<DependencyRow[]>(
    () =>
      step?.dependencies.map((d) => ({ ...d, _clientId: genClientId() })) ?? [],
  )

  // ---- Response Handlers state ----
  const [responseHandlers, setResponseHandlers] = useState<HandlerRow[]>(
    () =>
      step?.responseHandlers.map((h) => ({ ...h, _clientId: genClientId() })) ?? [],
  )

  // ---- Extract Variables state ----
  const [extractVariables, setExtractVariables] = useState<ExtractRow[]>(
    () =>
      step?.extractVariables.map((v) => ({ ...v, _clientId: genClientId() })) ?? [],
  )

  // ---- Verifications state ----
  const [verifications, setVerifications] = useState<VerificationRow[]>(
    () =>
      (step?.verifications ?? []).map((v) => ({
        ...v,
        _clientId: genClientId(),
        assertions: (v.assertions ?? []).map((a) => ({ ...a, _clientId: genClientId() })),
      })),
  )

  // ---- Response Validations state ----
  const [responseValidations, setResponseValidations] = useState<ResponseValidationRow[]>(
    () =>
      (step?.responseValidations ?? []).map((rv) => ({
        ...rv,
        _clientId: genClientId(),
      })),
  )

  // ---- Group Name state ----
  const [groupName, setGroupName] = useState(step?.groupName ?? '')

  // ---- Dependency Only state ----
  const [dependencyOnly, setDependencyOnly] = useState(step?.dependencyOnly ?? false)

  // ---- Cache Settings state ----
  const [cacheable, setCacheable] = useState(step?.cacheable ?? false)
  const [cacheTtlSeconds, setCacheTtlSeconds] = useState(step?.cacheTtlSeconds ?? 0)

  const [saving, setSaving] = useState(false)

  // Steps available for dependency / side-effect picker (exclude self)
  const otherSteps = allSteps.filter((s) => s.id !== step?.id)

  // Resolve transitive dependency chain for autocomplete (only dependent steps)
  const depStepInfos: DepStepInfo[] = (() => {
    const stepMap = new Map(allSteps.map((s) => [s.id, s]))
    const visited = new Set<string>()
    const result: DepStepInfo[] = []

    const visit = (stepId: string) => {
      if (visited.has(stepId)) return
      visited.add(stepId)
      const s = stepMap.get(stepId)
      if (!s) return
      for (const dep of s.dependencies) {
        visit(dep.dependsOnStepId)
      }
      // Only add the dependency steps, not self
      if (stepId !== step?.id) {
        result.push({
          name: s.name,
          variables: s.extractVariables.map((v) => v.variableName),
        })
      }
    }

    // Also walk dependencies from current editor state (for new/changed deps)
    for (const dep of dependencies) {
      if (dep.dependsOnStepId) visit(dep.dependsOnStepId)
    }

    return result
  })()

  // For verification fields: include current step's own variables (available after extraction, before verification runs)
  const verificationDepStepInfos: DepStepInfo[] = (() => {
    const selfVars = extractVariables.map((v) => v.variableName).filter(Boolean)
    if (selfVars.length === 0 || !name.trim()) return depStepInfos
    const selfInfo: DepStepInfo = { name: name.trim(), variables: selfVars }
    // Avoid duplicate if somehow already present
    if (depStepInfos.some((d) => d.name === name.trim())) return depStepInfos
    return [...depStepInfos, selfInfo]
  })()

  // ====================
  // Headers helpers
  // ====================
  const addHeader = () => {
    setHeaders([...headers, { _clientId: genClientId(), key: '', value: '' }])
  }
  const updateHeader = (index: number, field: keyof KeyValuePair, value: string) => {
    const updated = [...headers]
    updated[index] = { ...updated[index], [field]: value }
    setHeaders(updated)
  }
  const removeHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index))
  }

  // ====================
  // Query Params helpers
  // ====================
  const addQueryParam = () => {
    setQueryParams([...queryParams, { _clientId: genClientId(), key: '', value: '' }])
  }
  const updateQueryParam = (index: number, field: keyof KeyValuePair, value: string) => {
    const updated = [...queryParams]
    updated[index] = { ...updated[index], [field]: value }
    setQueryParams(updated)
  }
  const removeQueryParam = (index: number) => {
    setQueryParams(queryParams.filter((_, i) => i !== index))
  }

  // ====================
  // Dependencies helpers
  // ====================
  const addDependency = () => {
    setDependencies([
      ...dependencies,
      { _clientId: genClientId(), dependsOnStepId: '', useCache: true, reuseManualInput: true },
    ])
  }
  const updateDependency = (
    index: number,
    field: keyof StepDependencyDto,
    value: string | boolean,
  ) => {
    const updated = [...dependencies]
    updated[index] = { ...updated[index], [field]: value }
    setDependencies(updated)
  }
  const removeDependency = (index: number) => {
    setDependencies(dependencies.filter((_, i) => i !== index))
  }

  // ====================
  // Response Handlers helpers
  // ====================
  const addHandler = () => {
    setResponseHandlers([
      ...responseHandlers,
      {
        _clientId: genClientId(),
        matchCode: '',
        action: 'SUCCESS',
        retryCount: 0,
        retryDelaySeconds: 0,
        priority: 0,
      },
    ])
  }
  const updateHandler = (
    index: number,
    field: keyof StepResponseHandlerDto,
    value: string | number | undefined,
  ) => {
    const updated = [...responseHandlers]
    updated[index] = { ...updated[index], [field]: value } as HandlerRow
    setResponseHandlers(updated)
  }
  const removeHandler = (index: number) => {
    setResponseHandlers(responseHandlers.filter((_, i) => i !== index))
  }

  // ====================
  // Extract Variables helpers
  // ====================
  const addExtractVariable = () => {
    setExtractVariables([
      ...extractVariables,
      {
        _clientId: genClientId(),
        variableName: '',
        jsonPath: '',
        source: 'RESPONSE_BODY',
      },
    ])
  }
  const updateExtractVariable = (
    index: number,
    field: keyof StepExtractVariableDto,
    value: string,
  ) => {
    const updated = [...extractVariables]
    updated[index] = { ...updated[index], [field]: value }
    setExtractVariables(updated)
  }
  const removeExtractVariable = (index: number) => {
    setExtractVariables(extractVariables.filter((_, i) => i !== index))
  }

  // ====================
  // Verifications helpers
  // ====================
  const addVerification = () => {
    setVerifications([
      ...verifications,
      {
        _clientId: genClientId(),
        connectorName: '',
        query: '',
        timeoutSeconds: 0,
        queryTimeoutSeconds: 30,
        preListen: false,
        assertions: [],
      },
    ])
  }

  const updateVerification = (index: number, field: string, value: unknown) => {
    const updated = [...verifications]
    updated[index] = { ...updated[index], [field]: value }
    setVerifications(updated)
  }

  const removeVerification = (index: number) => {
    setVerifications(verifications.filter((_, i) => i !== index))
  }

  const addAssertion = (verificationIndex: number) => {
    const updated = [...verifications]
    updated[verificationIndex] = {
      ...updated[verificationIndex],
      assertions: [
        ...updated[verificationIndex].assertions,
        { _clientId: genClientId(), jsonPath: '', operator: 'EQUALS' as AssertionOperatorType, expectedValue: '' },
      ],
    }
    setVerifications(updated)
  }

  const updateAssertion = (vIndex: number, aIndex: number, field: string, value: string) => {
    const updated = [...verifications]
    const assertions = [...updated[vIndex].assertions]
    assertions[aIndex] = { ...assertions[aIndex], [field]: value }
    updated[vIndex] = { ...updated[vIndex], assertions }
    setVerifications(updated)
  }

  const removeAssertion = (vIndex: number, aIndex: number) => {
    const updated = [...verifications]
    updated[vIndex] = {
      ...updated[vIndex],
      assertions: updated[vIndex].assertions.filter((_, i) => i !== aIndex),
    }
    setVerifications(updated)
  }

  // ====================
  // Response Validation helpers
  // ====================
  const addResponseValidation = (type: ResponseValidationType) => {
    setResponseValidations([
      ...responseValidations,
      {
        _clientId: genClientId(),
        validationType: type,
        headerName: '',
        jsonPath: '',
        operator: 'EQUALS',
        expectedValue: '',
        expectedBody: '',
        matchMode: 'STRICT',
        expectedType: 'STRING',
      },
    ])
  }
  const updateResponseValidation = (index: number, field: string, value: unknown) => {
    const updated = [...responseValidations]
    updated[index] = { ...updated[index], [field]: value }
    setResponseValidations(updated)
  }
  const removeResponseValidation = (index: number) => {
    setResponseValidations(responseValidations.filter((_, i) => i !== index))
  }

  // Form Data helpers
  // ====================
  const addFormDataField = () => {
    setFormDataFields([...formDataFields, { _clientId: genClientId(), key: '', type: 'text', value: '' }])
  }
  const updateFormDataField = (index: number, field: keyof FormDataField, value: string) => {
    const updated = [...formDataFields]
    updated[index] = { ...updated[index], [field]: value }
    // Auto-switch type to 'file' when a ${FILE:...} value is entered
    if (field === 'value' && /^\$\{FILE:.+\}$/.test(value.trim())) {
      updated[index] = { ...updated[index], type: 'file' }
    }
    setFormDataFields(updated)
  }
  const removeFormDataField = (index: number) => {
    setFormDataFields(formDataFields.filter((_, i) => i !== index))
  }

  // JSON body validation
  const handleBodyChange = (val: string) => {
    setBody(val)
    if (bodyType === 'JSON' && val.trim()) {
      try {
        JSON.parse(val)
        setJsonError(null)
      } catch (e) {
        setJsonError((e as Error).message)
      }
    } else {
      setJsonError(null)
    }
  }

  // ====================
  // Save
  // ====================
  const handleSave = async () => {
    if (!name.trim()) {
      message.error(t('components.stepEditor.stepNameRequired'))
      return
    }
    if (!url.trim()) {
      message.error(t('components.stepEditor.urlRequired'))
      return
    }

    if (bodyType === 'JSON' && body.trim() && jsonError) {
      message.error(t('components.stepEditor.fixJsonErrors'))
      return
    }

    // Merge step headers + default header overrides
    const stepHeaders = headers.map(({ _clientId: _, ...rest }) => rest)
    Object.entries(defaultHeaderOverrides).forEach(([key, value]) => {
      stepHeaders.push({ key, value })
    })

    const request: TestStepRequest = {
      name: name.trim(),
      method,
      url: url.trim(),
      headers: stepHeaders,
      bodyType,
      body: bodyType === 'JSON' ? body : bodyType === 'NONE' ? '' : body,
      formDataFields: bodyType === 'FORM_DATA' ? formDataFields.map(({ _clientId: _, ...rest }) => rest) : [],
      queryParams: queryParams.map(({ _clientId: _, ...rest }) => rest),
      cacheable,
      cacheTtlSeconds: cacheable ? cacheTtlSeconds : 0,
      dependencyOnly,
      disabledDefaultHeaders: Array.from(disabledDefaultHeaders),
      oauthMode,
      groupName: groupName.trim() || '',
      dependencies: dependencies.map(({ _clientId: _, ...rest }) => rest),
      responseHandlers: responseHandlers.map(({ _clientId: _, ...rest }) => rest),
      extractVariables: extractVariables.map(({ _clientId: _, ...rest }) => rest),
      verifications: verifications.map(({ _clientId: _, assertions, ...rest }) => ({
        ...rest,
        assertions: assertions.map(({ _clientId: __, ...aRest }) => aRest),
      })),
      responseValidations: responseValidations.map(({ _clientId: _, ...rest }) => rest),
    }

    try {
      setSaving(true)
      if (isNew) {
        await testStepApi.create(suiteId, request)
        message.success(t('components.stepEditor.stepCreated'))
      } else {
        await testStepApi.update(suiteId, step.id, request)
        message.success(t('components.stepEditor.stepUpdated'))
      }
      onSave()
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        message.error(axiosErr.response?.data?.error ?? t('components.stepEditor.failedSaveStep'))
      } else {
        message.error(t('components.stepEditor.failedSaveStep'))
      }
    } finally {
      setSaving(false)
    }
  }

  // ====================
  // Column definitions
  // ====================

  const kvColumns = (
    updateFn: (index: number, field: keyof KeyValuePair, value: string) => void,
    removeFn: (index: number) => void,
  ) => [
    {
      title: t('components.stepEditor.key'),
      dataIndex: 'key',
      width: '40%',
      render: (_: string, record: KVRow, index: number) => (
        <Input
          placeholder={t('components.stepEditor.key')}
          value={record.key}
          onChange={(e) => updateFn(index, 'key', e.target.value)}
          size="small"
        />
      ),
    },
    {
      title: t('components.stepEditor.value'),
      dataIndex: 'value',
      width: '45%',
      render: (_: string, record: KVRow, index: number) => (
        <PlaceholderInput
          placeholder={t('components.stepEditor.value')}
          value={record.value}
          onChange={(val) => updateFn(index, 'value', val)}
          envVars={envVarNames}
          depSteps={depStepInfos}
          size="small"
        />
      ),
    },
    {
      title: '',
      key: 'actions',
      width: '8%',
      render: (_: unknown, _record: KVRow, index: number) => (
        <Popconfirm title={t('components.stepEditor.removeConfirm')} onConfirm={() => removeFn(index)} okType="danger">
          <Button type="text" danger icon={<DeleteOutlined />} size="small" />
        </Popconfirm>
      ),
    },
  ]

  const dependencyColumns = [
    {
      title: t('components.stepEditor.dependsOn'),
      dataIndex: 'dependsOnStepId',
      width: '40%',
      render: (_: string, record: DependencyRow, index: number) => (
        <Select
          showSearch
          value={record.dependsOnStepId || undefined}
          onChange={(val) => updateDependency(index, 'dependsOnStepId', val)}
          placeholder={t('components.stepEditor.selectStep')}
          size="small"
          style={{ width: '100%' }}
          options={otherSteps.map((s) => ({ label: s.name, value: s.id }))}
          filterOption={(input, option) =>
            (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
          }
        />
      ),
    },
    {
      title: t('components.stepEditor.useCache'),
      dataIndex: 'useCache',
      width: '12%',
      render: (_: boolean, record: DependencyRow, index: number) => (
        <Switch
          size="small"
          checked={record.useCache}
          onChange={(checked) => updateDependency(index, 'useCache', checked)}
        />
      ),
    },
    {
      title: t('components.stepEditor.reuseInput'),
      dataIndex: 'reuseManualInput',
      width: '12%',
      render: (_: boolean, record: DependencyRow, index: number) => (
        <Switch
          size="small"
          checked={record.reuseManualInput ?? true}
          onChange={(checked) => updateDependency(index, 'reuseManualInput', checked)}
        />
      ),
    },
    {
      title: t('components.stepEditor.ttl'),
      key: 'ttl',
      width: '18%',
      render: (_: unknown, record: DependencyRow) => {
        if (!record.useCache) return null
        const producer = allSteps.find((s) => s.id === record.dependsOnStepId)
        if (!producer) return <span style={{ color: '#999' }}>-</span>
        if (!producer.cacheable)
          return <span style={{ color: '#999' }}>{t('components.stepEditor.notCacheable')}</span>
        if (producer.cacheTtlSeconds === 0)
          return <span>{t('components.stepEditor.entireRun')}</span>
        return <span>{producer.cacheTtlSeconds}s</span>
      },
    },
    {
      title: '',
      key: 'actions',
      width: '8%',
      render: (_: unknown, _record: DependencyRow, index: number) => (
        <Popconfirm title={t('components.stepEditor.removeConfirm')} onConfirm={() => removeDependency(index)} okType="danger">
          <Button type="text" danger icon={<DeleteOutlined />} size="small" />
        </Popconfirm>
      ),
    },
  ]

  const handlerColumns = [
    {
      title: t('components.stepEditor.matchCode'),
      dataIndex: 'matchCode',
      width: '15%',
      render: (_: string, record: HandlerRow, index: number) => (
        <Input
          placeholder={t('components.stepEditor.matchCodePlaceholder')}
          value={record.matchCode}
          onChange={(e) => updateHandler(index, 'matchCode', e.target.value)}
          size="small"
        />
      ),
    },
    {
      title: t('components.stepEditor.action'),
      dataIndex: 'action',
      width: '18%',
      render: (_: string, record: HandlerRow, index: number) => (
        <Select
          value={record.action}
          onChange={(val) => updateHandler(index, 'action', val)}
          options={ACTION_OPTIONS}
          size="small"
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: t('components.stepEditor.sideEffectStep'),
      key: 'sideEffectStepId',
      width: '18%',
      render: (_: unknown, record: HandlerRow, index: number) => {
        if (record.action !== 'FIRE_SIDE_EFFECT') return null
        return (
          <Select
            showSearch
            value={record.sideEffectStepId || undefined}
            onChange={(val) => updateHandler(index, 'sideEffectStepId', val)}
            placeholder={t('components.stepEditor.selectStep')}
            size="small"
            style={{ width: '100%' }}
            options={otherSteps.map((s) => ({ label: s.name, value: s.id }))}
            filterOption={(input, option) =>
              (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
            }
          />
        )
      },
    },
    {
      title: t('components.stepEditor.retryCount'),
      key: 'retryCount',
      width: '12%',
      render: (_: unknown, record: HandlerRow, index: number) => {
        if (record.action !== 'RETRY') return null
        return (
          <InputNumber
            value={record.retryCount}
            onChange={(val) => updateHandler(index, 'retryCount', val ?? 0)}
            size="small"
            style={{ width: '100%' }}
            min={0}
          />
        )
      },
    },
    {
      title: t('components.stepEditor.retryDelay'),
      key: 'retryDelaySeconds',
      width: '12%',
      render: (_: unknown, record: HandlerRow, index: number) => {
        if (record.action !== 'RETRY') return null
        return (
          <InputNumber
            value={record.retryDelaySeconds}
            onChange={(val) => updateHandler(index, 'retryDelaySeconds', val ?? 0)}
            size="small"
            style={{ width: '100%' }}
            min={0}
          />
        )
      },
    },
    {
      title: t('components.stepEditor.priority'),
      dataIndex: 'priority',
      width: '10%',
      render: (_: number, record: HandlerRow, index: number) => (
        <InputNumber
          value={record.priority}
          onChange={(val) => updateHandler(index, 'priority', val ?? 0)}
          size="small"
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: '',
      key: 'actions',
      width: '6%',
      render: (_: unknown, _record: HandlerRow, index: number) => (
        <Popconfirm title={t('components.stepEditor.removeConfirm')} onConfirm={() => removeHandler(index)} okType="danger">
          <Button type="text" danger icon={<DeleteOutlined />} size="small" />
        </Popconfirm>
      ),
    },
  ]

  const extractColumns = [
    {
      title: t('components.stepEditor.variableName'),
      dataIndex: 'variableName',
      width: '30%',
      render: (_: string, record: ExtractRow, index: number) => (
        <Input
          placeholder={t('components.stepEditor.variableNamePlaceholder')}
          value={record.variableName}
          onChange={(e) => updateExtractVariable(index, 'variableName', e.target.value)}
          size="small"
        />
      ),
    },
    {
      title: t('components.stepEditor.jsonPathKey'),
      dataIndex: 'jsonPath',
      width: '30%',
      render: (_: string, record: ExtractRow, index: number) => {
        const ph = record.source === 'RESPONSE_HEADER' || record.source === 'REQUEST_HEADER'
          ? t('components.stepEditor.jsonPathHeader')
          : record.source === 'QUERY_PARAM'
            ? t('components.stepEditor.jsonPathParam')
            : record.source === 'STATUS_CODE' || record.source === 'REQUEST_URL'
              ? t('components.stepEditor.jsonPathNotUsed')
              : t('components.stepEditor.jsonPathPlaceholder')
        return (
          <Input
            placeholder={ph}
            value={record.jsonPath}
            onChange={(e) => updateExtractVariable(index, 'jsonPath', e.target.value)}
            size="small"
            disabled={record.source === 'STATUS_CODE' || record.source === 'REQUEST_URL'}
          />
        )
      },
    },
    {
      title: t('components.stepEditor.source'),
      dataIndex: 'source',
      width: '25%',
      render: (_: string, record: ExtractRow, index: number) => (
        <Select
          value={record.source}
          onChange={(val) => updateExtractVariable(index, 'source', val)}
          options={SOURCE_OPTIONS}
          size="small"
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: '',
      key: 'actions',
      width: '8%',
      render: (_: unknown, _record: ExtractRow, index: number) => (
        <Popconfirm title={t('components.stepEditor.removeConfirm')} onConfirm={() => removeExtractVariable(index)} okType="danger">
          <Button type="text" danger icon={<DeleteOutlined />} size="small" />
        </Popconfirm>
      ),
    },
  ]

  // ====================
  // Tab badge counts
  // ====================
  const totalHeaders = envHeaders.length + headers.length
  const totalParams = queryParams.length

  // ====================
  // Render
  // ====================
  return (
    <div className="request-editor">
      {/* ===== REQUEST BAR (Postman-style) ===== */}
      <div style={{ padding: '4px 0 10px' }}>
        <div className="request-editor-meta">
          <Input
            placeholder={t('components.stepEditor.stepNamePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ fontWeight: 560, flex: 1 }}
          />
          <Input
            placeholder={t('components.stepEditor.groupOptional')}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            style={{ width: 168 }}
          />
        </div>
        <div className="request-editor-bar">
          <Select
            className="request-editor-method"
            showSearch
            value={method}
            onChange={(val) => setMethod(val)}
            style={{ width: 112, flexShrink: 0 }}
            filterOption={(input, option) =>
              (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
            }
            options={METHOD_OPTIONS.map((opt) => ({
              label: (
                <span style={{ color: opt.color, fontWeight: 700, fontSize: 13 }}>{opt.label}</span>
              ),
              value: opt.value,
            }))}
            dropdownStyle={{ minWidth: 112 }}
          />
          <div className="request-editor-url">
            <PlaceholderInput
              placeholder={t('components.stepEditor.urlPlaceholder')}
              value={url}
              onChange={setUrl}
              envVars={envVarNames}
              depSteps={depStepInfos}
              size="middle"
            />
          </div>
        </div>
        <div className="request-editor-options">
          <label className="request-editor-option">
            <Switch size="small" checked={dependencyOnly} onChange={setDependencyOnly} />
            {t('components.stepEditor.dependencyOnly')}
          </label>
          <label className="request-editor-option">
            <Switch size="small" checked={cacheable} onChange={(checked) => setCacheable(checked)} />
            {t('components.stepEditor.cacheable')}
          </label>
          {cacheable && (
            <label className="request-editor-option">
              {t('components.stepEditor.ttl')}
              <InputNumber
                value={cacheTtlSeconds}
                onChange={(val) => setCacheTtlSeconds(val ?? 0)}
                min={0}
                placeholder={t('components.stepEditor.ttlPlaceholder')}
                size="small"
                style={{ width: 120 }}
              />
            </label>
          )}
          <label className="request-editor-option">
            {t('components.stepEditor.oauth')}
            <Select
              size="small"
              value={oauthMode}
              onChange={setOauthMode}
              options={[
                { label: t('components.stepEditor.oauthInherit'), value: 'INHERIT' },
                { label: t('components.stepEditor.oauthDisabled'), value: 'DISABLED' },
              ]}
              style={{ width: 200 }}
            />
          </label>
        </div>
      </div>

      {/* ===== HORIZONTAL TABS (Postman-style) ===== */}
      <Tabs
        defaultActiveKey="headers"
        size="small"
        style={{ marginTop: 4 }}
        tabBarStyle={{ marginBottom: 8 }}
        items={[
          {
            key: 'headers',
            label: (
              <span>
                {t('components.stepEditor.tabHeaders')}
                {totalHeaders > 0 && (
                  <Badge count={totalHeaders} size="small" style={{ marginLeft: 6, backgroundColor: '#597ef7' }} />
                )}
              </span>
            ),
            children: (
              <div>
                {envHeaders.length > 0 && (
                  <div style={{ marginBottom: headers.length > 0 ? 12 : 0 }}>
                    <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 6, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{t('components.stepEditor.defaultHeaders')}</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, border: '1px solid #f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
                      <thead>
                        <tr style={{ background: '#fafafa', textAlign: 'left' }}>
                          <th style={{ padding: '5px 8px', fontWeight: 500, width: 40, fontSize: 11, color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: '0.3px', borderBottom: '1px solid #f0f0f0' }}>{t('components.stepEditor.on')}</th>
                          <th style={{ padding: '5px 8px', fontWeight: 500, width: '30%', fontSize: 11, color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: '0.3px', borderBottom: '1px solid #f0f0f0' }}>{t('components.stepEditor.key')}</th>
                          <th style={{ padding: '5px 8px', fontWeight: 500, width: '25%', fontSize: 11, color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: '0.3px', borderBottom: '1px solid #f0f0f0' }}>{t('components.stepEditor.type')}</th>
                          <th style={{ padding: '5px 8px', fontWeight: 500, fontSize: 11, color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: '0.3px', borderBottom: '1px solid #f0f0f0' }}>{t('components.stepEditor.value')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {envHeaders.map((eh) => {
                          const enabled = !disabledDefaultHeaders.has(eh.headerKey)
                          const overrideValue = defaultHeaderOverrides[eh.headerKey]
                          const hasOverride = overrideValue !== undefined
                          const displayType = eh.valueType === 'ISO_TIMESTAMP' ? t('components.stepEditor.isoTimestamp') : eh.valueType === 'VARIABLE' ? t('components.stepEditor.variable') : eh.valueType
                          const displayValue = eh.valueType === 'UUID' || eh.valueType === 'ISO_TIMESTAMP'
                            ? t('components.stepEditor.autoGenerated')
                            : (hasOverride ? overrideValue : eh.headerValue)
                          const isAutoGen = eh.valueType === 'UUID' || eh.valueType === 'ISO_TIMESTAMP'
                          return (
                            <tr key={eh.headerKey} style={{ borderBottom: '1px solid #f0f0f0', opacity: enabled ? 1 : 0.45 }}>
                              <td style={{ padding: '4px 8px' }}>
                                <Switch
                                  size="small"
                                  checked={enabled}
                                  onChange={(checked) => {
                                    const next = new Set(disabledDefaultHeaders)
                                    if (checked) next.delete(eh.headerKey)
                                    else next.add(eh.headerKey)
                                    setDisabledDefaultHeaders(next)
                                  }}
                                />
                              </td>
                              <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: 12 }}>{eh.headerKey}</td>
                              <td style={{ padding: '4px 8px', color: '#8c8c8c', fontSize: 12 }}>{displayType}</td>
                              <td style={{ padding: '4px 8px' }}>
                                {isAutoGen ? (
                                  <span style={{ color: '#999', fontStyle: 'italic', fontSize: 12 }}>{displayValue}</span>
                                ) : (
                                  <Input
                                    size="small"
                                    value={displayValue}
                                    placeholder={eh.headerValue || t('components.stepEditor.value')}
                                    disabled={!enabled}
                                    onChange={(e) => {
                                      const val = e.target.value
                                      setDefaultHeaderOverrides((prev) => {
                                        if (val === eh.headerValue) {
                                          const { [eh.headerKey]: _, ...rest } = prev
                                          return rest
                                        }
                                        return { ...prev, [eh.headerKey]: val }
                                      })
                                    }}
                                    style={hasOverride ? { borderColor: '#faad14' } : undefined}
                                  />
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    {headers.length > 0 && (
                      <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 12, marginBottom: 6, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{t('components.stepEditor.stepSpecificHeaders')}</div>
                    )}
                  </div>
                )}
                <Table
                  columns={kvColumns(updateHeader, removeHeader)}
                  dataSource={headers}
                  rowKey="_clientId"
                  pagination={false}
                  size="small"
                  locale={{ emptyText: envHeaders.length > 0 ? t('components.stepEditor.noStepSpecificHeaders') : t('components.stepEditor.noHeadersAdded') }}
                />
                <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addHeader} style={{ marginTop: 8 }}>
                  {t('components.stepEditor.addHeader')}
                </Button>
              </div>
            ),
          },
          {
            key: 'params',
            label: (
              <span>
                {t('components.stepEditor.tabParams')}
                {totalParams > 0 && (
                  <Badge count={totalParams} size="small" style={{ marginLeft: 6, backgroundColor: '#597ef7' }} />
                )}
              </span>
            ),
            children: (
              <div>
                <Table
                  columns={kvColumns(updateQueryParam, removeQueryParam)}
                  dataSource={queryParams}
                  rowKey="_clientId"
                  pagination={false}
                  size="small"
                  locale={{ emptyText: t('components.stepEditor.noQueryParams') }}
                />
                <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addQueryParam} style={{ marginTop: 8 }}>
                  {t('components.stepEditor.addParam')}
                </Button>
              </div>
            ),
          },
          {
            key: 'body',
            label: (
              <span>
                {t('components.stepEditor.tabBody')}
                {bodyType !== 'NONE' && (
                  <span style={{ fontSize: 11, color: '#1677ff', marginLeft: 4 }}>({bodyType === 'JSON' ? t('components.stepEditor.bodyJson') : t('components.stepEditor.bodyForm')})</span>
                )}
              </span>
            ),
            children: (
              <div>
                <div style={{ marginBottom: 8 }}>
                  <Select
                    size="small"
                    value={bodyType}
                    onChange={(val) => { setBodyType(val); setJsonError(null) }}
                    options={[
                      { label: t('components.stepEditor.bodyNone'), value: 'NONE' },
                      { label: t('components.stepEditor.bodyJson'), value: 'JSON' },
                      { label: t('components.stepEditor.bodyFormData'), value: 'FORM_DATA' },
                    ]}
                    style={{ width: 140 }}
                  />
                </div>
                {bodyType === 'NONE' ? (
                  <div style={{ color: '#999', fontSize: 12, padding: '8px 0' }}>{t('components.stepEditor.noRequestBody')}</div>
                ) : bodyType === 'JSON' ? (
                  <div>
                    <PlaceholderInput
                      mode="textarea"
                      rows={8}
                      value={body}
                      onChange={handleBodyChange}
                      envVars={envVarNames}
                      depSteps={depStepInfos}
                      placeholder={t('components.stepEditor.bodyJsonPlaceholder')}
                    />
                    {jsonError && (
                      <div style={{ color: '#ff4d4f', fontSize: 11, marginTop: 4 }}>{t('components.stepEditor.jsonError', { error: jsonError })}</div>
                    )}
                  </div>
                ) : (
                  <div>
                    <Table
                      columns={[
                        {
                          title: t('components.stepEditor.key'),
                          dataIndex: 'key',
                          width: '25%',
                          render: (_: unknown, __: unknown, index: number) => (
                            <Input
                              size="small"
                              value={formDataFields[index].key}
                              onChange={(e) => updateFormDataField(index, 'key', e.target.value)}
                              placeholder={t('components.stepEditor.fieldName')}
                            />
                          ),
                        },
                        {
                          title: t('components.stepEditor.type'),
                          dataIndex: 'type',
                          width: 100,
                          render: (_: unknown, __: unknown, index: number) => (
                            <Select
                              size="small"
                              value={formDataFields[index].type}
                              onChange={(val) => updateFormDataField(index, 'type', val)}
                              options={[
                                { label: t('components.stepEditor.fieldTypeText'), value: 'text' },
                                { label: t('components.stepEditor.fieldTypeFile'), value: 'file' },
                              ]}
                              style={{ width: '100%' }}
                            />
                          ),
                        },
                        {
                          title: t('components.stepEditor.value'),
                          dataIndex: 'value',
                          render: (_: unknown, __: unknown, index: number) => (
                            <PlaceholderInput
                              value={formDataFields[index].value}
                              onChange={(val) => updateFormDataField(index, 'value', val)}
                              envVars={envVarNames}
                              depSteps={depStepInfos}
                              fileKeys={fileKeys}
                              placeholder={formDataFields[index].type === 'file' ? t('components.stepEditor.fileValuePlaceholder') : t('components.stepEditor.valueOrVarPlaceholder')}
                            />
                          ),
                        },
                        {
                          title: '',
                          width: 40,
                          render: (_: unknown, __: unknown, index: number) => (
                            <Popconfirm title={t('components.stepEditor.removeConfirm')} onConfirm={() => removeFormDataField(index)} okType="danger">
                              <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                            </Popconfirm>
                          ),
                        },
                      ]}
                      dataSource={formDataFields}
                      rowKey="_clientId"
                      pagination={false}
                      size="small"
                      locale={{ emptyText: t('components.stepEditor.noFormFields') }}
                    />
                    <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addFormDataField} style={{ marginTop: 8 }}>
                      {t('components.stepEditor.addField')}
                    </Button>
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'dependencies',
            label: (
              <span>
                {t('components.stepEditor.tabDependencies')}
                {dependencies.length > 0 && (
                  <Badge count={dependencies.length} size="small" style={{ marginLeft: 6, backgroundColor: '#73d13d' }} />
                )}
              </span>
            ),
            children: (
              <div>
                <Table
                  columns={dependencyColumns}
                  dataSource={dependencies}
                  rowKey="_clientId"
                  pagination={false}
                  size="small"
                  locale={{ emptyText: t('components.stepEditor.noDependencies') }}
                />
                <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addDependency} style={{ marginTop: 8 }}>
                  {t('components.stepEditor.addDependency')}
                </Button>
              </div>
            ),
          },
          {
            key: 'responseHandlers',
            label: (
              <span>
                {t('components.stepEditor.tabHandlers')}
                {responseHandlers.length > 0 && (
                  <Badge count={responseHandlers.length} size="small" style={{ marginLeft: 6, backgroundColor: '#ffc53d' }} />
                )}
              </span>
            ),
            children: (
              <div>
                <Table
                  columns={handlerColumns}
                  dataSource={responseHandlers}
                  rowKey="_clientId"
                  pagination={false}
                  size="small"
                  locale={{ emptyText: t('components.stepEditor.noResponseHandlers') }}
                />
                <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addHandler} style={{ marginTop: 8 }}>
                  {t('components.stepEditor.addHandler')}
                </Button>
              </div>
            ),
          },
          {
            key: 'extractVariables',
            label: (
              <span>
                {t('components.stepEditor.tabVariables')}
                {extractVariables.length > 0 && (
                  <Badge count={extractVariables.length} size="small" style={{ marginLeft: 6, backgroundColor: '#ff7a45' }} />
                )}
              </span>
            ),
            children: (
              <div>
                <Table
                  columns={extractColumns}
                  dataSource={extractVariables}
                  rowKey="_clientId"
                  pagination={false}
                  size="small"
                  locale={{ emptyText: t('components.stepEditor.noExtractVariables') }}
                />
                <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addExtractVariable} style={{ marginTop: 8 }}>
                  {t('components.stepEditor.addVariable')}
                </Button>
              </div>
            ),
          },
          {
            key: 'responseValidation',
            label: (
              <span>
                {t('components.stepEditor.tabResponseValidation')}
                {responseValidations.length > 0 && (
                  <Badge count={responseValidations.length} size="small" style={{ marginLeft: 6, backgroundColor: '#13c2c2' }} />
                )}
              </span>
            ),
            children: (
              <div>
                {responseValidations.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#8c8c8c', padding: '20px 16px', fontSize: 12, background: '#fafafa', borderRadius: 4, border: '1px dashed #d9d9d9' }}>
                    {t('components.stepEditor.noResponseValidations')}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {responseValidations.map((rv, rvIdx) => {
                      const typeConfig: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
                        HEADER: { label: t('components.stepEditor.validationHeader'), color: '#0958d9', bg: '#e6f4ff', border: '#91caff', icon: 'H' },
                        BODY_EXACT_MATCH: { label: t('components.stepEditor.validationBodyMatch'), color: '#531dab', bg: '#f9f0ff', border: '#d3adf7', icon: 'B' },
                        BODY_FIELD: { label: t('components.stepEditor.validationField'), color: '#006d75', bg: '#e6fffb', border: '#87e8de', icon: 'F' },
                        BODY_DATA_TYPE: { label: t('components.stepEditor.validationType'), color: '#ad4e00', bg: '#fff7e6', border: '#ffd591', icon: 'T' },
                      }
                      const cfg = typeConfig[rv.validationType] || typeConfig.HEADER
                      return (
                        <div key={rv._clientId} style={{ border: `1px solid ${cfg.border}`, borderLeft: `3px solid ${cfg.color}`, borderRadius: 4, padding: '8px 10px', background: '#fff' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <span style={{ width: 20, height: 20, borderRadius: 3, background: cfg.color, color: '#fff', fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{cfg.icon}</span>
                            <span style={{ fontSize: 12, fontWeight: 500, color: cfg.color }}>{cfg.label}</span>
                            <div style={{ flex: 1 }} />
                            <Popconfirm title={t('components.stepEditor.removeValidation')} onConfirm={() => removeResponseValidation(rvIdx)} okText={t('common.yes')} cancelText={t('common.no')}>
                              <Button type="text" danger size="small" icon={<DeleteOutlined />} style={{ opacity: 0.6 }} />
                            </Popconfirm>
                          </div>

                          {rv.validationType === 'HEADER' && (
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                              <div style={{ flex: 1, minWidth: 120 }}>
                                <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{t('components.stepEditor.headerName')}</div>
                                <Input size="small" value={rv.headerName ?? ''} onChange={(e) => updateResponseValidation(rvIdx, 'headerName', e.target.value)} placeholder="Content-Type" />
                              </div>
                              <div style={{ width: 130 }}>
                                <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{t('components.stepEditor.operator')}</div>
                                <Select size="small" style={{ width: '100%' }} value={rv.operator ?? 'EQUALS'} onChange={(v) => updateResponseValidation(rvIdx, 'operator', v)} options={ASSERTION_OPERATOR_OPTIONS} />
                              </div>
                              <div style={{ flex: 1, minWidth: 120 }}>
                                <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{t('components.stepEditor.expectedValue')}</div>
                                <PlaceholderInput size="small" value={rv.expectedValue ?? ''} onChange={(v) => updateResponseValidation(rvIdx, 'expectedValue', v)} placeholder="application/json" envVars={envVarNames} depSteps={depStepInfos} fileKeys={fileKeys} />
                              </div>
                            </div>
                          )}

                          {rv.validationType === 'BODY_EXACT_MATCH' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ fontSize: 11, color: '#8c8c8c', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{t('components.stepEditor.matchMode')}</div>
                                <Select size="small" style={{ width: 130 }} value={rv.matchMode ?? 'STRICT'} onChange={(v) => updateResponseValidation(rvIdx, 'matchMode', v)} options={[
                                  { value: 'STRICT', label: t('components.stepEditor.matchStrict') },
                                  { value: 'FLEXIBLE', label: t('components.stepEditor.matchFlexible') },
                                  { value: 'STRUCTURE', label: t('components.stepEditor.matchStructure') },
                                ]} />
                                <span style={{ fontSize: 10, color: '#bfbfbf' }}>
                                  {(rv.matchMode ?? 'STRICT') === 'STRICT' ? t('components.stepEditor.matchStrictHint') : (rv.matchMode ?? 'STRICT') === 'FLEXIBLE' ? t('components.stepEditor.matchFlexibleHint') : t('components.stepEditor.matchStructureHint')}
                                </span>
                              </div>
                              <div>
                                <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{t('components.stepEditor.expectedBody')}</div>
                                <PlaceholderInput mode="textarea" rows={4} size="small" value={rv.expectedBody ?? ''} onChange={(v) => updateResponseValidation(rvIdx, 'expectedBody', v)} placeholder={t('components.stepEditor.expectedBodyPlaceholder')} envVars={envVarNames} depSteps={depStepInfos} fileKeys={fileKeys} />
                              </div>
                            </div>
                          )}

                          {rv.validationType === 'BODY_FIELD' && (
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                              <div style={{ flex: 1, minWidth: 120 }}>
                                <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{t('components.stepEditor.jsonPath')}</div>
                                <Input size="small" value={rv.jsonPath ?? ''} onChange={(e) => updateResponseValidation(rvIdx, 'jsonPath', e.target.value)} placeholder={t('components.stepEditor.jsonPathExample')} style={{ fontFamily: 'monospace' }} />
                              </div>
                              <div style={{ width: 130 }}>
                                <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{t('components.stepEditor.operator')}</div>
                                <Select size="small" style={{ width: '100%' }} value={rv.operator ?? 'EQUALS'} onChange={(v) => updateResponseValidation(rvIdx, 'operator', v)} options={ASSERTION_OPERATOR_OPTIONS} />
                              </div>
                              <div style={{ flex: 1, minWidth: 120 }}>
                                <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{t('components.stepEditor.expectedValue')}</div>
                                <PlaceholderInput size="small" value={rv.expectedValue ?? ''} onChange={(v) => updateResponseValidation(rvIdx, 'expectedValue', v)} placeholder="expected" envVars={envVarNames} depSteps={depStepInfos} fileKeys={fileKeys} />
                              </div>
                            </div>
                          )}

                          {rv.validationType === 'BODY_DATA_TYPE' && (
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                              <div style={{ flex: 1, minWidth: 150 }}>
                                <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3px' }}>JSON Path</div>
                                <Input size="small" value={rv.jsonPath ?? ''} onChange={(e) => updateResponseValidation(rvIdx, 'jsonPath', e.target.value)} placeholder={t('components.stepEditor.jsonPathCountExample')} style={{ fontFamily: 'monospace' }} />
                              </div>
                              <div style={{ width: 140 }}>
                                <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{t('components.stepEditor.expectedType')}</div>
                                <Select size="small" style={{ width: '100%' }} value={rv.expectedType ?? 'STRING'} onChange={(v) => updateResponseValidation(rvIdx, 'expectedType', v)} options={DATA_TYPE_OPTIONS} />
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Button size="small" icon={<PlusOutlined />} onClick={() => addResponseValidation('HEADER')} style={{ borderColor: '#91caff', color: '#0958d9' }}>{t('components.stepEditor.validationHeader')}</Button>
                  <Button size="small" icon={<PlusOutlined />} onClick={() => addResponseValidation('BODY_EXACT_MATCH')} style={{ borderColor: '#d3adf7', color: '#531dab' }}>{t('components.stepEditor.validationBodyMatch')}</Button>
                  <Button size="small" icon={<PlusOutlined />} onClick={() => addResponseValidation('BODY_FIELD')} style={{ borderColor: '#87e8de', color: '#006d75' }}>{t('components.stepEditor.validationField')}</Button>
                  <Button size="small" icon={<PlusOutlined />} onClick={() => addResponseValidation('BODY_DATA_TYPE')} style={{ borderColor: '#ffd591', color: '#ad4e00' }}>{t('components.stepEditor.validationType')}</Button>
                </div>
              </div>
            ),
          },
          {
            key: 'verifications',
            label: (
              <span>
                {t('components.stepEditor.tabVerifications')}
                {verifications.length > 0 && (
                  <Badge count={verifications.length} size="small" style={{ marginLeft: 6, backgroundColor: '#722ed1' }} />
                )}
              </span>
            ),
            children: (
              <div>
                {verifications.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#8c8c8c', padding: '20px 16px', fontSize: 12, background: '#fafafa', borderRadius: 4, border: '1px dashed #d9d9d9' }}>
                    {t('components.stepEditor.noVerifications')}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {verifications.map((v, vIdx) => {
                      const connectorType = connectorNames.find((c) => c.name === v.connectorName)?.type
                      const showPreListen = connectorType === 'KAFKA' || connectorType === 'RABBITMQ'
                      return (
                        <div
                          key={v._clientId}
                          style={{
                            border: '1px solid #d3adf7',
                            borderLeft: '3px solid #531dab',
                            borderRadius: 4,
                            padding: '8px 10px',
                            background: '#fff',
                          }}
                        >
                          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{t('components.stepEditor.connector')}</div>
                              <Select
                                showSearch
                                value={v.connectorName || undefined}
                                onChange={(val) => updateVerification(vIdx, 'connectorName', val)}
                                placeholder={t('components.stepEditor.selectConnector')}
                                size="small"
                                style={{ width: '100%' }}
                                options={connectorNames.map((c) => ({ label: `${c.name} (${c.type})`, value: c.name }))}
                                filterOption={(input, option) =>
                                  (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
                                }
                              />
                            </div>
                            <div style={{ width: 90 }}>
                              <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                                {showPreListen ? t('components.stepEditor.timeoutSeconds') : t('components.stepEditor.delaySeconds')}
                              </div>
                              <InputNumber
                                value={v.timeoutSeconds}
                                onChange={(val) => updateVerification(vIdx, 'timeoutSeconds', val ?? (showPreListen ? 30 : 0))}
                                min={0}
                                size="small"
                                style={{ width: '100%' }}
                              />
                            </div>
                            {!showPreListen && (
                              <div style={{ width: 110 }}>
                                <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{t('components.stepEditor.queryTimeoutSeconds')}</div>
                                <InputNumber
                                  value={v.queryTimeoutSeconds}
                                  onChange={(val) => updateVerification(vIdx, 'queryTimeoutSeconds', val ?? 30)}
                                  min={1}
                                  size="small"
                                  style={{ width: '100%' }}
                                />
                              </div>
                            )}
                            {showPreListen && (
                              <div style={{ paddingTop: 22 }}>
                                <Checkbox
                                  checked={v.preListen}
                                  onChange={(e) => updateVerification(vIdx, 'preListen', e.target.checked)}
                                >
                                  {t('components.stepEditor.preListen')}
                                </Checkbox>
                              </div>
                            )}
                            <div style={{ paddingTop: 18 }}>
                              <Popconfirm title={t('components.stepEditor.removeVerification')} onConfirm={() => removeVerification(vIdx)} okType="danger">
                                <Button type="text" danger icon={<DeleteOutlined />} size="small" style={{ opacity: 0.6 }} />
                              </Popconfirm>
                            </div>
                          </div>

                          {connectorType === 'KAFKA' ? (
                            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{t('components.stepEditor.topic')}</div>
                                <PlaceholderInput
                                  value={parseKafkaQuery(v.query).topic}
                                  onChange={(val) => updateVerification(vIdx, 'query', buildKafkaQuery(val, parseKafkaQuery(v.query).key))}
                                  envVars={envVarNames}
                                  depSteps={verificationDepStepInfos}
                                  placeholder={t('components.stepEditor.topicPlaceholder')}
                                  size="small"
                                />
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{t('components.stepEditor.keyOptional')}</div>
                                <PlaceholderInput
                                  value={parseKafkaQuery(v.query).key}
                                  onChange={(val) => updateVerification(vIdx, 'query', buildKafkaQuery(parseKafkaQuery(v.query).topic, val))}
                                  envVars={envVarNames}
                                  depSteps={verificationDepStepInfos}
                                  placeholder={t('components.stepEditor.keyPlaceholder')}
                                  size="small"
                                />
                              </div>
                            </div>
                          ) : (
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{t('components.stepEditor.query')}</div>
                              <PlaceholderInput
                                mode="textarea"
                                rows={3}
                                value={v.query}
                                onChange={(val) => updateVerification(vIdx, 'query', val)}
                                envVars={envVarNames}
                                depSteps={verificationDepStepInfos}
                                placeholder={t('components.stepEditor.queryPlaceholder')}
                                size="small"
                              />
                            </div>
                          )}

                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                              <span style={{ fontSize: 11, color: '#8c8c8c', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{t('components.stepEditor.assertions', { count: v.assertions.length })}</span>
                              <Button size="small" icon={<PlusOutlined />} onClick={() => addAssertion(vIdx)} style={{ borderColor: '#d3adf7', color: '#531dab' }}>
                                {t('components.stepEditor.addAssertion')}
                              </Button>
                            </div>
                            <Table
                              columns={[
                                {
                                  title: t('components.stepEditor.jsonPath'),
                                  dataIndex: 'jsonPath',
                                  width: '35%',
                                  render: (_: string, record: AssertionRow, aIdx: number) => (
                                    <Input
                                      placeholder={t('components.stepEditor.jsonPathAssertionPlaceholder')}
                                      value={record.jsonPath}
                                      onChange={(e) => updateAssertion(vIdx, aIdx, 'jsonPath', e.target.value)}
                                      size="small"
                                    />
                                  ),
                                },
                                {
                                  title: t('components.stepEditor.operator'),
                                  dataIndex: 'operator',
                                  width: '22%',
                                  render: (_: string, record: AssertionRow, aIdx: number) => (
                                    <Select
                                      value={record.operator}
                                      onChange={(val) => updateAssertion(vIdx, aIdx, 'operator', val)}
                                      options={ASSERTION_OPERATOR_OPTIONS}
                                      size="small"
                                      style={{ width: '100%' }}
                                    />
                                  ),
                                },
                                {
                                  title: t('components.stepEditor.expectedValue'),
                                  dataIndex: 'expectedValue',
                                  width: '33%',
                                  render: (_: string, record: AssertionRow, aIdx: number) => (
                                    <PlaceholderInput
                                      placeholder={t('components.stepEditor.expectedValuePlaceholder')}
                                      value={record.expectedValue}
                                      onChange={(val) => updateAssertion(vIdx, aIdx, 'expectedValue', val)}
                                      envVars={envVarNames}
                                      depSteps={verificationDepStepInfos}
                                      size="small"
                                    />
                                  ),
                                },
                                {
                                  title: '',
                                  key: 'actions',
                                  width: '8%',
                                  render: (_: unknown, _record: AssertionRow, aIdx: number) => (
                                    <Popconfirm title={t('components.stepEditor.removeConfirm')} onConfirm={() => removeAssertion(vIdx, aIdx)} okType="danger">
                                      <Button type="text" danger icon={<DeleteOutlined />} size="small" />
                                    </Popconfirm>
                                  ),
                                },
                              ]}
                              dataSource={v.assertions}
                              rowKey="_clientId"
                              pagination={false}
                              size="small"
                              locale={{ emptyText: t('components.stepEditor.noAssertions') }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                <Button size="small" icon={<PlusOutlined />} onClick={addVerification} style={{ marginTop: 10, borderColor: '#d3adf7', color: '#531dab' }}>
                  {t('components.stepEditor.addVerification')}
                </Button>
              </div>
            ),
          },
        ]}
      />

      {/* ===== SAVE / CANCEL ===== */}
      <div className="step-editor-footer">
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="primary" onClick={handleSave} loading={saving}>
          {t('components.stepEditor.saveStep')}
        </Button>
      </div>
    </div>
  )
}
