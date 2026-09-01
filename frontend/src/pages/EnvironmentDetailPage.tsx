import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Card,
  Collapse,
  Form,
  Input,
  InputNumber,
  Button,
  Space,
  Switch,
  Select,
  Table,
  Popconfirm,
  Tooltip,
  Typography,
  Modal,
  Upload,
  message,
  Spin,
} from 'antd'
import {
  ArrowLeftOutlined,
  PlusOutlined,
  DeleteOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  SaveOutlined,
  ApiOutlined,
  UploadOutlined,
  DownloadOutlined,
} from '@ant-design/icons'
import type {
  VariableDto,
  HeaderDto,
  HeaderValueType,
  VariableValueType,
  ConnectorDto,
  ConnectorType,
  EnvironmentFileResponse,
  EnvironmentOAuthRequest,
  OAuthClientAuthMethod,
} from '../types/environment'
import { environmentApi } from '../services/environmentApi'

const { Title } = Typography

interface ConnectorFieldDef {
  key: string
  labelKey?: string
  secret?: boolean
  type?: 'text' | 'toggle' | 'textarea'
  showWhen?: string
}

const SSL_FIELDS: ConnectorFieldDef[] = [
  { key: 'ssl', type: 'toggle' },
  { key: 'caCertificate', type: 'textarea', showWhen: 'ssl' },
]

const CONNECTOR_CONFIG_FIELDS: Record<ConnectorType, ConnectorFieldDef[]> = {
  MYSQL: [
    { key: 'host' },
    { key: 'port' },
    { key: 'database' },
    { key: 'username' },
    { key: 'password', secret: true },
    ...SSL_FIELDS,
  ],
  POSTGRES: [
    { key: 'host' },
    { key: 'port' },
    { key: 'database' },
    { key: 'username' },
    { key: 'password', secret: true },
    ...SSL_FIELDS,
  ],
  ORACLE: [
    { key: 'host' },
    { key: 'port' },
    { key: 'database' },
    { key: 'username' },
    { key: 'password', secret: true },
    ...SSL_FIELDS,
  ],
  SQLSERVER: [
    { key: 'host' },
    { key: 'port' },
    { key: 'database' },
    { key: 'username' },
    { key: 'password', secret: true },
    ...SSL_FIELDS,
  ],
  REDIS: [
    { key: 'host' },
    { key: 'port' },
    { key: 'password', secret: true },
    { key: 'database', labelKey: 'databaseRedis' },
    ...SSL_FIELDS,
  ],
  ELASTICSEARCH: [
    { key: 'url' },
    { key: 'username' },
    { key: 'password', secret: true },
    ...SSL_FIELDS,
  ],
  KAFKA: [
    { key: 'brokers' },
    { key: 'groupId' },
    { key: 'securityProtocol' },
    { key: 'saslMechanism' },
    { key: 'saslUsername' },
    { key: 'saslPassword', secret: true },
    ...SSL_FIELDS,
  ],
  RABBITMQ: [
    { key: 'host' },
    { key: 'port' },
    { key: 'virtualHost' },
    { key: 'username' },
    { key: 'password', secret: true },
    ...SSL_FIELDS,
  ],
  MONGODB: [
    { key: 'connectionString' },
    ...SSL_FIELDS,
  ],
}

const CONNECTOR_TYPE_I18N: Record<ConnectorType, string> = {
  MYSQL: 'mysql',
  POSTGRES: 'postgres',
  ORACLE: 'oracle',
  SQLSERVER: 'sqlServer',
  REDIS: 'redis',
  ELASTICSEARCH: 'elasticsearch',
  KAFKA: 'kafka',
  RABBITMQ: 'rabbitmq',
  MONGODB: 'mongodb',
}

const MASKED_SECRET = '••••••••'

interface OAuthFormState {
  enabled: boolean
  tokenEndpoint: string
  clientId: string
  clientSecret: string
  scopes: string
  audience: string
  clientAuthMethod: OAuthClientAuthMethod
  refreshSkewSeconds: number
  requestTimeoutMs: number
}

function createDefaultOAuth(): OAuthFormState {
  return {
    enabled: false,
    tokenEndpoint: '',
    clientId: '',
    clientSecret: '',
    scopes: '',
    audience: '',
    clientAuthMethod: 'client_secret_basic',
    refreshSkewSeconds: 60,
    requestTimeoutMs: 10_000,
  }
}

// Stable client-side ID for new rows
let nextClientId = 1

type VariableRow = VariableDto & { _clientId: string }
type HeaderRow = HeaderDto & { _clientId: string }
type ConnectorRow = ConnectorDto & { _clientId: string }

function getDuplicateIndices<T>(items: T[], getKey: (item: T) => string): Set<number> {
  const seen = new Map<string, number[]>()
  items.forEach((item, i) => {
    const k = getKey(item).trim()
    if (k) {
      seen.set(k, [...(seen.get(k) ?? []), i])
    }
  })
  const dupes = new Set<number>()
  seen.forEach((indices) => {
    if (indices.length > 1) indices.forEach((i) => dupes.add(i))
  })
  return dupes
}

export default function EnvironmentDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [form] = Form.useForm()
  const isNew = id === 'new'

  const valueTypeOptions = useMemo(
    (): { label: string; value: HeaderValueType }[] => [
      { label: t('pages.environmentDetail.valueTypeStatic'), value: 'STATIC' },
      { label: t('pages.environmentDetail.valueTypeVariable'), value: 'VARIABLE' },
      { label: t('pages.environmentDetail.valueTypeUuid'), value: 'UUID' },
      { label: t('pages.environmentDetail.valueTypeIsoTimestamp'), value: 'ISO_TIMESTAMP' },
    ],
    [t],
  )

  const variableValueTypeOptions = useMemo(
    (): { label: string; value: VariableValueType }[] => [
      { label: t('pages.environmentDetail.valueTypeStatic'), value: 'STATIC' },
      { label: t('pages.environmentDetail.valueTypeUuid'), value: 'UUID' },
      { label: t('pages.environmentDetail.valueTypeIsoTimestamp'), value: 'ISO_TIMESTAMP' },
    ],
    [t],
  )

  const connectorTypeOptions = useMemo(
    (): { label: string; value: ConnectorType }[] =>
      (Object.keys(CONNECTOR_TYPE_I18N) as ConnectorType[]).map((type) => ({
        label: t(`pages.environmentDetail.connectorTypes.${CONNECTOR_TYPE_I18N[type]}`),
        value: type,
      })),
    [t],
  )

  const connectorFieldLabel = (field: ConnectorFieldDef) =>
    t(`pages.environmentDetail.connectorFields.${field.labelKey ?? field.key}`)

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [variables, setVariables] = useState<VariableRow[]>([])
  const [headers, setHeaders] = useState<HeaderRow[]>([])
  const [connectors, setConnectors] = useState<ConnectorRow[]>([])
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set())
  const [showErrors, setShowErrors] = useState(false)
  const [testingConnector, setTestingConnector] = useState<Record<string, boolean>>({})
  const [files, setFiles] = useState<EnvironmentFileResponse[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [uploadFileKey, setUploadFileKey] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [oauth, setOAuth] = useState<OAuthFormState>(() => createDefaultOAuth())
  const [oauthSecretConfigured, setOAuthSecretConfigured] = useState(false)
  const [oauthSecretDirty, setOAuthSecretDirty] = useState(false)
  const [oauthClearSecret, setOAuthClearSecret] = useState(false)
  const clientIdCounter = useRef(nextClientId)

  const genClientId = () => {
    const cid = `_new_${clientIdCounter.current++}`
    return cid
  }

  useEffect(() => {
    if (isNew || !id) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const env = await environmentApi.get(id)
        if (cancelled) return
        form.setFieldsValue({ name: env.name, baseUrl: env.baseUrl })
        setVariables(env.variables.map((v) => ({ ...v, _clientId: v.id ?? genClientId() })))
        setHeaders(env.headers.map((h) => ({ ...h, _clientId: h.id ?? genClientId() })))
        setConnectors((env.connectors ?? []).map((c) => ({ ...c, _clientId: c.id ?? genClientId() })))
        const serverOAuth = env.oauth
        if (serverOAuth) {
          setOAuth({
            enabled: serverOAuth.enabled,
            tokenEndpoint: serverOAuth.tokenEndpoint ?? '',
            clientId: serverOAuth.clientId ?? '',
            clientSecret: serverOAuth.clientSecret ?? '',
            scopes: serverOAuth.scopes ?? '',
            audience: serverOAuth.audience ?? '',
            clientAuthMethod: serverOAuth.clientAuthMethod === 'client_secret_post'
              ? 'client_secret_post'
              : 'client_secret_basic',
            refreshSkewSeconds: serverOAuth.refreshSkewSeconds ?? 60,
            requestTimeoutMs: serverOAuth.requestTimeoutMs ?? 10_000,
          })
          setOAuthSecretConfigured(serverOAuth.clientSecretConfigured)
        } else {
          setOAuth(createDefaultOAuth())
          setOAuthSecretConfigured(false)
        }
        setOAuthSecretDirty(false)
        setOAuthClearSecret(false)
      } catch {
        if (cancelled) return
        message.error(t('pages.environmentDetail.failedLoad'))
        navigate('/environments')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew])

  // --- Load files for existing environments ---
  const loadFiles = async () => {
    if (isNew || !id) return
    setFilesLoading(true)
    try {
      const data = await environmentApi.listFiles(id)
      setFiles(data)
    } catch {
      // Silently fail — files are optional
    } finally {
      setFilesLoading(false)
    }
  }

  useEffect(() => {
    if (!isNew && id) loadFiles()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew])

  const handleUploadFile = async () => {
    if (!id || !uploadFileKey.trim() || !uploadFile) {
      message.error(t('pages.environmentDetail.fileKeyRequired'))
      return
    }
    setUploading(true)
    try {
      await environmentApi.uploadFile(id, uploadFileKey.trim(), uploadFile)
      message.success(t('pages.environmentDetail.fileUploaded'))
      setUploadModalOpen(false)
      setUploadFileKey('')
      setUploadFile(null)
      loadFiles()
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        message.error(axiosErr.response?.data?.error ?? t('pages.environmentDetail.uploadFailed'))
      } else {
        message.error(t('pages.environmentDetail.uploadFailed'))
      }
    } finally {
      setUploading(false)
    }
  }

  const handleDownloadFile = async (file: EnvironmentFileResponse) => {
    if (!id) return
    try {
      const blob = await environmentApi.downloadFile(id, file.id)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch {
      message.error(t('pages.environmentDetail.downloadFailed'))
    }
  }

  const handleDeleteFile = async (fileId: string) => {
    if (!id) return
    try {
      await environmentApi.deleteFile(id, fileId)
      message.success(t('pages.environmentDetail.fileDeleted'))
      loadFiles()
    } catch {
      message.error(t('pages.environmentDetail.deleteFailed'))
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  // --- Validation for empty fields ---
  const emptyVarKeys = new Set(variables.map((v, i) => !v.key.trim() ? i : -1).filter((i) => i >= 0))
  const emptyVarValues = new Set(variables.map((v, i) => (v.valueType !== 'UUID' && v.valueType !== 'ISO_TIMESTAMP' && !v.value.trim()) ? i : -1).filter((i) => i >= 0))
  const emptyHdrKeys = new Set(headers.map((h, i) => !h.headerKey.trim() ? i : -1).filter((i) => i >= 0))
  const emptyConnNames = new Set(connectors.map((c, i) => !c.name.trim() ? i : -1).filter((i) => i >= 0))
  const hasEmptyFields = emptyVarKeys.size > 0 || emptyVarValues.size > 0 || emptyHdrKeys.size > 0 || emptyConnNames.size > 0

  const updateOAuth = <K extends keyof OAuthFormState>(field: K, value: OAuthFormState[K]) => {
    setOAuth((previous) => ({ ...previous, [field]: value }))
  }

  const updateOAuthSecret = (value: string) => {
    setOAuth((previous) => ({ ...previous, clientSecret: value }))
    setOAuthSecretDirty(true)
    setOAuthClearSecret(false)
  }

  const handleSave = async () => {
    setShowErrors(true)
    if (hasDuplicates) {
      message.error(t('pages.environmentDetail.duplicateKeysError'))
      return
    }
    if (hasEmptyFields) {
      message.error(t('pages.environmentDetail.requiredFieldsError'))
      return
    }
    if (oauth.enabled) {
      if (!oauth.tokenEndpoint.trim() || !oauth.clientId.trim()) {
        message.error(t('pages.environmentDetail.oauthTokenRequired'))
        return
      }
      if (oauthClearSecret || (!oauthSecretConfigured && !oauth.clientSecret)) {
        message.error(t('pages.environmentDetail.oauthSecretRequired'))
        return
      }
      if (!Number.isFinite(oauth.requestTimeoutMs) || oauth.requestTimeoutMs <= 0) {
        message.error(t('pages.environmentDetail.oauthTimeoutError'))
        return
      }
      if (!Number.isFinite(oauth.refreshSkewSeconds) || oauth.refreshSkewSeconds < 0) {
        message.error(t('pages.environmentDetail.oauthRefreshSkewError'))
        return
      }
    }
    try {
      const values = await form.validateFields()
      setSaving(true)

      const oauthRequest: EnvironmentOAuthRequest = {
        enabled: oauth.enabled,
        tokenEndpoint: oauth.tokenEndpoint.trim(),
        clientId: oauth.clientId.trim(),
        scopes: oauth.scopes.trim(),
        audience: oauth.audience.trim(),
        clientAuthMethod: oauth.clientAuthMethod,
        refreshSkewSeconds: oauth.refreshSkewSeconds,
        requestTimeoutMs: oauth.requestTimeoutMs,
        ...(oauthClearSecret
          ? { clearClientSecret: true }
          : (oauthSecretDirty || !oauthSecretConfigured)
            ? { clientSecret: oauth.clientSecret }
            : {}),
      }

      const request = {
        name: values.name,
        baseUrl: values.baseUrl,
        variables: variables.map(({ _clientId, ...rest }) => rest),
        headers: headers.map(({ _clientId, ...rest }) => rest),
        connectors: connectors.map(({ _clientId, ...rest }) => rest),
        oauth: oauthRequest,
      }

      if (isNew) {
        await environmentApi.create(request)
        message.success(t('pages.environmentDetail.created'))
      } else {
        await environmentApi.update(id!, request)
        message.success(t('pages.environmentDetail.updated'))
      }
      navigate('/environments')
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

  // --- Variables helpers ---
  const addVariable = () => {
    setVariables([...variables, { _clientId: genClientId(), key: '', value: '', valueType: 'STATIC', secret: false }])
  }

  const updateVariable = (index: number, field: keyof VariableDto, value: string | boolean) => {
    const updated = [...variables]
    updated[index] = { ...updated[index], [field]: value }
    setVariables(updated)
  }

  const removeVariable = (index: number) => {
    const removedId = variables[index]._clientId
    setVariables(variables.filter((_, i) => i !== index))
    setRevealedIds((prev) => {
      const next = new Set(prev)
      next.delete(removedId)
      return next
    })
  }

  const toggleReveal = (clientId: string) => {
    setRevealedIds((prev) => {
      const next = new Set(prev)
      if (next.has(clientId)) {
        next.delete(clientId)
      } else {
        next.add(clientId)
      }
      return next
    })
  }

  // --- Headers helpers ---
  const addHeader = () => {
    setHeaders([...headers, { _clientId: genClientId(), headerKey: '', valueType: 'STATIC', headerValue: '' }])
  }

  const updateHeader = (index: number, field: keyof HeaderDto, value: string) => {
    const updated = [...headers]
    updated[index] = { ...updated[index], [field]: value }
    // Clear headerValue when switching to auto-generated types
    if (field === 'valueType' && (value === 'UUID' || value === 'ISO_TIMESTAMP')) {
      updated[index].headerValue = ''
    }
    setHeaders(updated)
  }

  const removeHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index))
  }

  // --- Connectors helpers ---
  const addConnector = () => {
    setConnectors([...connectors, { _clientId: genClientId(), name: '', type: 'MYSQL', config: {} }])
  }

  const updateConnector = (index: number, field: string, value: unknown) => {
    const updated = [...connectors]
    if (field === 'type') {
      // Reset config when type changes
      updated[index] = { ...updated[index], type: value as ConnectorType, config: {} }
    } else if (field === 'config') {
      updated[index] = { ...updated[index], config: value as Record<string, string> }
    } else {
      updated[index] = { ...updated[index], [field]: value }
    }
    setConnectors(updated)
  }

  const updateConnectorConfig = (index: number, key: string, value: string) => {
    const updated = [...connectors]
    updated[index] = { ...updated[index], config: { ...updated[index].config, [key]: value } }
    setConnectors(updated)
  }

  const removeConnector = (index: number) => {
    setConnectors(connectors.filter((_, i) => i !== index))
  }

  const handleTestConnector = async (index: number) => {
    const conn = connectors[index]
    const clientId = conn._clientId
    setTestingConnector((prev) => ({ ...prev, [clientId]: true }))
    try {
      const result = await environmentApi.testConnector({
        type: conn.type,
        config: conn.config,
        environmentId: !isNew ? id : undefined,
        connectorName: conn.name || undefined,
      })
      if (result.success) {
        message.success(t('pages.environmentDetail.connectionSuccess', { durationMs: result.durationMs }))
      } else {
        message.error(result.message || t('pages.environmentDetail.connectionFailed'))
      }
    } catch {
      message.error(t('pages.environmentDetail.testConnectionFailed'))
    } finally {
      setTestingConnector((prev) => ({ ...prev, [clientId]: false }))
    }
  }

  // --- Duplicate detection ---
  const dupVarIndices = getDuplicateIndices(variables, (v) => v.key)
  const dupHdrIndices = getDuplicateIndices(headers, (h) => h.headerKey)
  const dupConnIndices = getDuplicateIndices(connectors, (c) => c.name)
  const hasDuplicates = dupVarIndices.size > 0 || dupHdrIndices.size > 0 || dupConnIndices.size > 0

  // --- Variable key options for VARIABLE type headers ---
  const variableKeyOptions = variables
    .filter((v) => v.key.trim() !== '')
    .map((v) => ({ label: v.key, value: v.key }))

  // --- Table columns ---
  const varColumns = [
    {
      title: t('common.key'),
      dataIndex: 'key',
      width: '25%',
      render: (_: string, record: VariableRow, index: number) => {
        const isDup = dupVarIndices.has(index)
        const isEmpty = showErrors && emptyVarKeys.has(index)
        const hasError = isDup || isEmpty
        const errorMsg = isDup ? t('pages.environmentDetail.duplicateVariableKey') : isEmpty ? t('pages.environmentDetail.keyRequired') : undefined
        return (
          <Tooltip title={errorMsg} color="red" open={hasError ? undefined : false}>
            <Input
              placeholder={t('pages.environmentDetail.variableKeyPlaceholder')}
              value={record.key}
              onChange={(e) => updateVariable(index, 'key', e.target.value)}
              size="small"
              status={hasError ? 'error' : undefined}
            />
          </Tooltip>
        )
      },
    },
    {
      title: t('pages.environmentDetail.valueType'),
      dataIndex: 'valueType',
      width: '15%',
      render: (_: string, record: VariableRow, index: number) => (
        <Select
          showSearch
          value={record.valueType || 'STATIC'}
          onChange={(val) => updateVariable(index, 'valueType', val)}
          options={variableValueTypeOptions}
          size="small"
          style={{ width: '100%' }}
          filterOption={(input, option) =>
            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
        />
      ),
    },
    {
      title: t('common.value'),
      dataIndex: 'value',
      width: '30%',
      render: (_: string, record: VariableRow, index: number) => {
        if (record.valueType === 'UUID' || record.valueType === 'ISO_TIMESTAMP') {
          return (
            <span style={{ color: '#999', fontStyle: 'italic', fontSize: 12 }}>
              {t('pages.environmentDetail.autoGenerated')}
            </span>
          )
        }
        const isMasked = record.secret && !revealedIds.has(record._clientId)
        const isEmpty = showErrors && emptyVarValues.has(index)
        return (
          <Tooltip title={isEmpty ? t('pages.environmentDetail.valueRequired') : undefined} color="red" open={isEmpty ? undefined : false}>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                placeholder={t('pages.environmentDetail.valuePlaceholder')}
                value={record.value}
                onChange={(e) => updateVariable(index, 'value', e.target.value)}
                type={isMasked ? 'password' : 'text'}
                size="small"
                status={isEmpty ? 'error' : undefined}
              />
            {record.secret && (
              <Button
                size="small"
                type="text"
                icon={revealedIds.has(record._clientId) ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                onClick={() => toggleReveal(record._clientId)}
              />
            )}
            </Space.Compact>
          </Tooltip>
        )
      },
    },
    {
      title: t('common.secret'),
      dataIndex: 'secret',
      width: '10%',
      render: (_: boolean, record: VariableRow, index: number) => (
        <Switch
          size="small"
          checked={record.secret}
          onChange={(checked) => updateVariable(index, 'secret', checked)}
          disabled={record.valueType === 'UUID' || record.valueType === 'ISO_TIMESTAMP'}
        />
      ),
    },
    {
      title: '',
      key: 'actions',
      width: '8%',
      render: (_: unknown, record: VariableRow) => {
        const index = variables.indexOf(record)
        return (
          <Popconfirm title={t('common.removeConfirm')} onConfirm={() => removeVariable(index)} okType="danger">
            <Button type="text" danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>
        )
      },
    },
  ]

  const headerColumns = [
    {
      title: t('pages.environmentDetail.headerKey'),
      dataIndex: 'headerKey',
      width: '28%',
      render: (_: string, record: HeaderRow, index: number) => {
        const isDup = dupHdrIndices.has(index)
        const isEmpty = showErrors && emptyHdrKeys.has(index)
        const hasError = isDup || isEmpty
        const errorMsg = isDup ? t('pages.environmentDetail.duplicateHeaderKey') : isEmpty ? t('pages.environmentDetail.headerKeyRequired') : undefined
        return (
          <Tooltip title={errorMsg} color="red" open={hasError ? undefined : false}>
            <Input
              placeholder={t('pages.environmentDetail.headerKeyPlaceholder')}
              value={record.headerKey}
              onChange={(e) => updateHeader(index, 'headerKey', e.target.value)}
              size="small"
              status={hasError ? 'error' : undefined}
            />
          </Tooltip>
        )
      },
    },
    {
      title: t('pages.environmentDetail.valueType'),
      dataIndex: 'valueType',
      width: '22%',
      render: (_: string, record: HeaderRow, index: number) => (
        <Select
          showSearch
          value={record.valueType}
          onChange={(val) => updateHeader(index, 'valueType', val)}
          options={valueTypeOptions}
          size="small"
          style={{ width: '100%' }}
          filterOption={(input, option) =>
            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
        />
      ),
    },
    {
      title: t('common.value'),
      dataIndex: 'headerValue',
      width: '30%',
      render: (_: string, record: HeaderRow, index: number) => {
        const type = record.valueType
        if (type === 'UUID' || type === 'ISO_TIMESTAMP') {
          return (
            <span style={{ color: '#999', fontStyle: 'italic', fontSize: 12 }}>
              {t('pages.environmentDetail.autoGenerated')}
            </span>
          )
        }
        if (type === 'VARIABLE') {
          return (
            <Select
              showSearch
              value={record.headerValue || undefined}
              onChange={(val) => updateHeader(index, 'headerValue', val)}
              options={variableKeyOptions}
              placeholder={t('pages.environmentDetail.selectVariable')}
              size="small"
              style={{ width: '100%' }}
              allowClear
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          )
        }
        return (
          <Input
            placeholder={t('pages.environmentDetail.headerValuePlaceholder')}
            value={record.headerValue}
            onChange={(e) => updateHeader(index, 'headerValue', e.target.value)}
            size="small"
          />
        )
      },
    },
    {
      title: '',
      key: 'actions',
      width: '8%',
      render: (_: unknown, _record: HeaderRow, index: number) => (
        <Popconfirm title={t('common.removeConfirm')} onConfirm={() => removeHeader(index)} okType="danger">
          <Button type="text" danger icon={<DeleteOutlined />} size="small" />
        </Popconfirm>
      ),
    },
  ]

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div className="suite-detail-title-wrap">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/environments')} />
          <div className="page-header-copy">
            <div className="page-header-kicker">{isNew ? t('pages.environmentDetail.createKicker') : t('pages.environmentDetail.kicker')}</div>
            <Title level={4} className="page-header-title" style={{ fontSize: 18 }}>
              {isNew ? t('pages.environments.newEnvironment') : t('pages.environmentDetail.editTitle')}
            </Title>
          </div>
        </div>
        <div className="page-header-actions">
          <Tooltip title={hasDuplicates ? t('pages.environmentDetail.fixDuplicatesTooltip') : (showErrors && hasEmptyFields) ? t('pages.environmentDetail.fillRequiredTooltip') : undefined}>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={saving}
              disabled={hasDuplicates || (showErrors && hasEmptyFields)}
            >
              {t('pages.environmentDetail.saveEnvironment')}
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="product-panel" style={{ marginBottom: 14 }}>
        <div className="product-panel-header">
          <div>
            <div className="product-panel-title">{t('pages.environmentDetail.basicsTitle')}</div>
            <div className="product-panel-subtitle">{t('pages.environmentDetail.basicsSubtitle')}</div>
          </div>
        </div>
        <div className="product-panel-body">
          <Form form={form} layout="vertical" requiredMark="optional">
            <div className="form-grid-2">
              <Form.Item
                name="name"
                label={t('common.name')}
                rules={[{ required: true, message: t('common.nameRequired') }]}
                extra={t('pages.environmentDetail.nameExtra')}
              >
                <Input placeholder={t('pages.environmentDetail.namePlaceholder')} autoFocus={isNew} />
              </Form.Item>
              <Form.Item
                name="baseUrl"
                label={t('pages.environmentDetail.baseUrl')}
                rules={[
                  { required: true, message: t('pages.environmentDetail.baseUrlRequired') },
                  { pattern: /^https?:\/\//, message: t('pages.environmentDetail.baseUrlPattern') },
                ]}
                extra={t('pages.environmentDetail.baseUrlExtra')}
              >
                <Input placeholder={t('pages.environmentDetail.baseUrlPlaceholder')} />
              </Form.Item>
            </div>
          </Form>
        </div>
      </div>

      <Card
        size="small"
        title={t('pages.environmentDetail.oauthTitle')}
        extra={
          <Space size={8}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('pages.environmentDetail.oauthHint')}
            </Typography.Text>
            <Switch checked={oauth.enabled} onChange={(checked) => updateOAuth('enabled', checked)} />
          </Space>
        }
        style={{ marginBottom: 12 }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{t('pages.environmentDetail.tokenEndpoint')}</div>
            <Input
              value={oauth.tokenEndpoint}
              onChange={(e) => updateOAuth('tokenEndpoint', e.target.value)}
              placeholder={t('pages.environmentDetail.tokenEndpointPlaceholder')}
              disabled={!oauth.enabled}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{t('pages.environmentDetail.clientId')}</div>
            <Input
              value={oauth.clientId}
              onChange={(e) => updateOAuth('clientId', e.target.value)}
              placeholder={t('pages.environmentDetail.clientIdPlaceholder')}
              disabled={!oauth.enabled}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{t('pages.environmentDetail.clientSecret')}</div>
            <Space.Compact style={{ width: '100%' }}>
              <Input.Password
                value={oauth.clientSecret}
                onChange={(e) => updateOAuthSecret(e.target.value)}
                placeholder={oauthSecretConfigured ? t('pages.environmentDetail.savedSecretMasked') : t('pages.environmentDetail.clientSecretPlaceholder')}
                visibilityToggle={false}
                disabled={!oauth.enabled && !oauthSecretConfigured}
              />
              {oauthSecretConfigured && (
                <Button
                  danger={oauthClearSecret}
                  type="default"
                  onClick={() => {
                    if (oauthClearSecret) {
                      setOAuth((previous) => ({ ...previous, clientSecret: MASKED_SECRET }))
                      setOAuthSecretDirty(false)
                      setOAuthClearSecret(false)
                    } else {
                      setOAuth((previous) => ({ ...previous, clientSecret: '' }))
                      setOAuthSecretDirty(true)
                      setOAuthClearSecret(true)
                    }
                  }}
                >
                  {oauthClearSecret ? t('pages.environmentDetail.undoClear') : t('pages.environmentDetail.clear')}
                </Button>
              )}
            </Space.Compact>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {oauthClearSecret
                ? t('pages.environmentDetail.secretRemoveHint')
                : oauthSecretConfigured
                  ? t('pages.environmentDetail.secretMaskedHint')
                  : t('pages.environmentDetail.secretStoredHint')}
            </Typography.Text>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{t('pages.environmentDetail.clientAuthentication')}</div>
            <Select
              value={oauth.clientAuthMethod}
              onChange={(value: OAuthClientAuthMethod) => updateOAuth('clientAuthMethod', value)}
              options={[
                { label: t('pages.environmentDetail.clientAuthBasic'), value: 'client_secret_basic' },
                { label: t('pages.environmentDetail.clientAuthPost'), value: 'client_secret_post' },
              ]}
              style={{ width: '100%' }}
              disabled={!oauth.enabled}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{t('pages.environmentDetail.scopes')}</div>
            <Input
              value={oauth.scopes}
              onChange={(e) => updateOAuth('scopes', e.target.value)}
              placeholder={t('pages.environmentDetail.scopesPlaceholder')}
              disabled={!oauth.enabled}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{t('pages.environmentDetail.audience')}</div>
            <Input
              value={oauth.audience}
              onChange={(e) => updateOAuth('audience', e.target.value)}
              placeholder={t('pages.environmentDetail.audiencePlaceholder')}
              disabled={!oauth.enabled}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{t('pages.environmentDetail.refreshSkew')}</div>
            <InputNumber
              min={0}
              value={oauth.refreshSkewSeconds}
              onChange={(value) => updateOAuth('refreshSkewSeconds', value ?? 0)}
              style={{ width: '100%' }}
              disabled={!oauth.enabled}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{t('pages.environmentDetail.requestTimeout')}</div>
            <InputNumber
              min={1}
              value={oauth.requestTimeoutMs}
              onChange={(value) => updateOAuth('requestTimeoutMs', value ?? 10_000)}
              style={{ width: '100%' }}
              disabled={!oauth.enabled}
            />
          </div>
        </div>
      </Card>

      <Card
        size="small"
        className="brand-card card-env"
        title={t('pages.environmentDetail.variablesTitle')}
        extra={
          <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addVariable}>
            {t('pages.environmentDetail.addVariable')}
          </Button>
        }
        style={{ marginBottom: 12 }}
      >
        <Table
          columns={varColumns}
          dataSource={variables}
          rowKey="_clientId"
          pagination={false}
          size="small"
          locale={{ emptyText: t('pages.environmentDetail.emptyVariables') }}
        />
      </Card>

      <Card
        size="small"
        className="brand-card card-env"
        title={t('pages.environmentDetail.defaultHeadersTitle')}
        extra={
          <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addHeader}>
            {t('pages.environmentDetail.addHeader')}
          </Button>
        }
      >
        <Table
          columns={headerColumns}
          dataSource={headers}
          rowKey="_clientId"
          pagination={false}
          size="small"
          locale={{ emptyText: t('pages.environmentDetail.emptyHeaders') }}
        />
      </Card>

      {!isNew && (
        <Card
          size="small"
          title={t('pages.environmentDetail.filesTitle')}
          extra={
            <Button type="dashed" size="small" icon={<UploadOutlined />} onClick={() => setUploadModalOpen(true)}>
              {t('pages.environmentDetail.uploadFile')}
            </Button>
          }
          style={{ marginTop: 12 }}
        >
          <Table
            columns={[
              { title: t('pages.environmentDetail.fileKey'), dataIndex: 'fileKey', key: 'fileKey', width: 200 },
              { title: t('pages.environmentDetail.fileName'), dataIndex: 'fileName', key: 'fileName' },
              { title: t('common.type'), dataIndex: 'contentType', key: 'contentType', width: 160 },
              { title: t('common.size'), dataIndex: 'fileSize', key: 'fileSize', width: 100, render: (v: number) => formatFileSize(v) },
              {
                title: t('common.actions'),
                key: 'actions',
                width: 100,
                render: (_: unknown, record: EnvironmentFileResponse) => (
                  <Space size={4}>
                    <Tooltip title={t('common.download')}>
                      <Button type="text" size="small" icon={<DownloadOutlined />} onClick={() => handleDownloadFile(record)} />
                    </Tooltip>
                    <Popconfirm title={t('pages.environmentDetail.deleteFileConfirm')} onConfirm={() => handleDeleteFile(record.id)} okType="danger">
                      <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
            dataSource={files}
            rowKey="id"
            pagination={false}
            size="small"
            loading={filesLoading}
            locale={{ emptyText: t('pages.environmentDetail.emptyFiles') }}
          />
          <Modal
            title={t('pages.environmentDetail.uploadModalTitle')}
            open={uploadModalOpen}
            onCancel={() => { setUploadModalOpen(false); setUploadFileKey(''); setUploadFile(null) }}
            onOk={handleUploadFile}
            confirmLoading={uploading}
            okText={t('common.upload')}
            okButtonProps={{ disabled: !uploadFileKey.trim() || !uploadFile }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{t('pages.environmentDetail.uploadFileKeyLabel')}</div>
                <Input
                  size="small"
                  value={uploadFileKey}
                  onChange={(e) => setUploadFileKey(e.target.value)}
                  placeholder={t('pages.environmentDetail.uploadFileKeyPlaceholder')}
                />
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{t('pages.environmentDetail.uploadFileLabel')}</div>
                <Upload
                  beforeUpload={(file) => { setUploadFile(file); return false }}
                  maxCount={1}
                  fileList={uploadFile ? [{ uid: '-1', name: uploadFile.name, status: 'done' as const }] : []}
                  onRemove={() => setUploadFile(null)}
                >
                  <Button size="small" icon={<UploadOutlined />}>{t('pages.environmentDetail.selectFile')}</Button>
                </Upload>
              </div>
            </div>
          </Modal>
        </Card>
      )}

      <Card
        size="small"
        title={t('pages.environmentDetail.connectorsTitle')}
        extra={
          <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addConnector}>
            {t('pages.environmentDetail.addConnector')}
          </Button>
        }
        style={{ marginTop: 12 }}
      >
        {connectors.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#999', padding: '12px 0' }}>
            {t('pages.environmentDetail.emptyConnectors')}
          </div>
        ) : (
          <Collapse
            size="small"
            items={connectors.map((conn, index) => {
              const isDupName = dupConnIndices.has(index)
              const isEmptyName = showErrors && emptyConnNames.has(index)
              const configFields = CONNECTOR_CONFIG_FIELDS[conn.type] ?? []
              return {
                key: conn._clientId,
                label: (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                    <Select
                      showSearch
                      value={conn.type}
                      onChange={(val) => updateConnector(index, 'type', val)}
                      options={connectorTypeOptions}
                      size="small"
                      style={{ width: 140 }}
                      filterOption={(input, option) =>
                        (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                      }
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Tooltip title={isDupName ? t('pages.environmentDetail.duplicateConnectorName') : isEmptyName ? t('pages.environmentDetail.connectorNameRequired') : undefined} color="red" open={isDupName || isEmptyName ? undefined : false}>
                      <Input
                        placeholder={t('pages.environmentDetail.connectorNamePlaceholder')}
                        value={conn.name}
                        onChange={(e) => { e.stopPropagation(); updateConnector(index, 'name', e.target.value) }}
                        onClick={(e) => e.stopPropagation()}
                        size="small"
                        style={{ width: 200 }}
                        status={isDupName || isEmptyName ? 'error' : undefined}
                      />
                    </Tooltip>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                      <Tooltip title={t('pages.environmentDetail.testConnection')}>
                        <Button
                          type="text"
                          icon={<ApiOutlined />}
                          size="small"
                          loading={testingConnector[conn._clientId]}
                          onClick={(e) => { e.stopPropagation(); handleTestConnector(index) }}
                        />
                      </Tooltip>
                      <Popconfirm title={t('pages.environmentDetail.removeConnectorConfirm')} onConfirm={() => removeConnector(index)} okType="danger">
                        <Button type="text" danger icon={<DeleteOutlined />} size="small" onClick={(e) => e.stopPropagation()} />
                      </Popconfirm>
                    </div>
                  </div>
                ),
                children: (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                    {configFields
                      .filter((field) => !field.showWhen || conn.config[field.showWhen] === 'true')
                      .map((field) => (
                      <div key={field.key} style={field.type === 'textarea' ? { gridColumn: '1 / -1' } : undefined}>
                        <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>{connectorFieldLabel(field)}</div>
                        {field.type === 'toggle' ? (
                          <Switch
                            size="small"
                            checked={conn.config[field.key] === 'true'}
                            onChange={(checked) => updateConnectorConfig(index, field.key, checked ? 'true' : 'false')}
                          />
                        ) : field.type === 'textarea' ? (
                          <Input.TextArea
                            size="small"
                            rows={3}
                            value={conn.config[field.key] ?? ''}
                            onChange={(e) => updateConnectorConfig(index, field.key, e.target.value)}
                            placeholder={t('pages.environmentDetail.caCertificatePlaceholder')}
                            style={{ fontFamily: 'monospace', fontSize: 11 }}
                          />
                        ) : field.secret ? (
                          <Input.Password
                            size="small"
                            value={conn.config[field.key] ?? ''}
                            onChange={(e) => updateConnectorConfig(index, field.key, e.target.value)}
                            placeholder={connectorFieldLabel(field)}
                          />
                        ) : (
                          <Input
                            size="small"
                            value={conn.config[field.key] ?? ''}
                            onChange={(e) => updateConnectorConfig(index, field.key, e.target.value)}
                            placeholder={connectorFieldLabel(field)}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                ),
              }
            })}
          />
        )}
      </Card>
    </div>
  )
}
