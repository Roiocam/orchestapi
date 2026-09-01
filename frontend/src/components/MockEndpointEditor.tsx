import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Input,
  Select,
  Switch,
  InputNumber,
  Tabs,
  Table,
  message,
} from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import type { MockEndpoint, MockEndpointRequest, MockMatchRuleDto, MockMatchRuleType } from '../types/mock'
import { mockApi } from '../services/mockApi'

const { TextArea } = Input

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ANY']

const METHOD_COLORS: Record<string, string> = {
  GET: '#52c41a',
  POST: '#1677ff',
  PUT: '#fa8c16',
  DELETE: '#ff4d4f',
  PATCH: '#722ed1',
  ANY: '#8c8c8c',
}

interface HeaderRow {
  _clientId: string
  key: string
  value: string
}

interface RuleRow {
  _clientId: string
  ruleType: MockMatchRuleType
  matchKey: string
  matchValue: string
}

let _cid = 0
const genId = () => `_c${++_cid}`

interface Props {
  serverId: string
  endpoint: MockEndpoint | null
  onSave: () => void
  onCancel: () => void
}

export default function MockEndpointEditor({ serverId, endpoint, onSave, onCancel }: Props) {
  const { t } = useTranslation()
  const isNew = !endpoint

  const [name, setName] = useState(endpoint?.name || '')
  const [description, setDescription] = useState(endpoint?.description || '')
  const [httpMethod, setHttpMethod] = useState(endpoint?.httpMethod || 'GET')
  const [pathPattern, setPathPattern] = useState(endpoint?.pathPattern || '/')
  const [responseStatus, setResponseStatus] = useState(endpoint?.responseStatus ?? 200)
  const [responseBody, setResponseBody] = useState(endpoint?.responseBody || '')
  const [delayMs, setDelayMs] = useState(endpoint?.delayMs ?? 0)
  const [enabled, setEnabled] = useState(endpoint?.enabled ?? true)
  const [saving, setSaving] = useState(false)

  const [responseHeaders, setResponseHeaders] = useState<HeaderRow[]>(
    () => (endpoint?.responseHeaders || []).map((h) => ({ _clientId: genId(), key: h.key, value: h.value })),
  )

  const [matchRules, setMatchRules] = useState<RuleRow[]>(
    () => (endpoint?.matchRules || []).map((r) => ({
      _clientId: genId(),
      ruleType: r.ruleType,
      matchKey: r.matchKey,
      matchValue: r.matchValue || '',
    })),
  )

  const ruleTypeOptions = useMemo(() => [
    { value: 'HEADER' as const, label: t('components.mockEndpointEditor.ruleTypeHeader') },
    { value: 'QUERY_PARAM' as const, label: t('components.mockEndpointEditor.ruleTypeQueryParam') },
    { value: 'BODY_JSON_PATH' as const, label: t('components.mockEndpointEditor.ruleTypeBodyJsonPath') },
  ], [t])

  const fieldLabel: React.CSSProperties = {
    textTransform: 'uppercase',
    color: '#8c8c8c',
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: 0.3,
    marginBottom: 4,
  }

  const handleSave = async () => {
    if (!name.trim()) { message.error(t('components.mockEndpointEditor.nameRequired')); return }
    if (!pathPattern.trim()) { message.error(t('components.mockEndpointEditor.pathRequired')); return }

    const data: MockEndpointRequest = {
      name: name.trim(),
      description: description.trim() || undefined,
      httpMethod,
      pathPattern: pathPattern.trim(),
      responseStatus,
      responseBody: responseBody || undefined,
      responseHeaders: responseHeaders
        .filter((h) => h.key.trim())
        .map((h) => ({ key: h.key.trim(), value: h.value })),
      delayMs,
      enabled,
      matchRules: matchRules
        .filter((r) => r.matchKey.trim())
        .map((r): MockMatchRuleDto => ({
          ruleType: r.ruleType,
          matchKey: r.matchKey.trim(),
          matchValue: r.matchValue.trim() || undefined,
        })),
    }

    setSaving(true)
    try {
      if (isNew) {
        await mockApi.createEndpoint(serverId, data)
        message.success(t('components.mockEndpointEditor.endpointCreated'))
      } else {
        await mockApi.updateEndpoint(serverId, endpoint.id, data)
        message.success(t('components.mockEndpointEditor.endpointUpdated'))
      }
      onSave()
    } catch (err: any) {
      message.error(err?.response?.data?.message || t('components.mockEndpointEditor.failedSave'))
    } finally {
      setSaving(false)
    }
  }

  const updateHeader = (id: string, field: 'key' | 'value', val: string) => {
    setResponseHeaders((prev) => prev.map((h) => h._clientId === id ? { ...h, [field]: val } : h))
  }

  const headerColumns = [
    {
      title: t('components.stepEditor.key'),
      dataIndex: 'key',
      render: (_: unknown, row: HeaderRow) => (
        <Input
          size="small"
          value={row.key}
          onChange={(e) => updateHeader(row._clientId, 'key', e.target.value)}
          placeholder={t('components.mockEndpointEditor.keyPlaceholder')}
        />
      ),
    },
    {
      title: t('components.stepEditor.value'),
      dataIndex: 'value',
      render: (_: unknown, row: HeaderRow) => (
        <Input
          size="small"
          value={row.value}
          onChange={(e) => updateHeader(row._clientId, 'value', e.target.value)}
          placeholder={t('components.mockEndpointEditor.valuePlaceholder')}
        />
      ),
    },
    {
      title: '',
      width: 40,
      render: (_: unknown, row: HeaderRow) => (
        <Button
          size="small"
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => setResponseHeaders((prev) => prev.filter((h) => h._clientId !== row._clientId))}
        />
      ),
    },
  ]

  const updateRule = (id: string, field: keyof RuleRow, val: string) => {
    setMatchRules((prev) => prev.map((r) => r._clientId === id ? { ...r, [field]: val } : r))
  }

  const ruleColumns = [
    {
      title: t('components.mockEndpointEditor.type'),
      width: 150,
      render: (_: unknown, row: RuleRow) => (
        <Select
          size="small"
          value={row.ruleType}
          onChange={(v) => updateRule(row._clientId, 'ruleType', v)}
          options={ruleTypeOptions}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: t('components.mockEndpointEditor.keyOrPath'),
      render: (_: unknown, row: RuleRow) => (
        <Input
          size="small"
          value={row.matchKey}
          onChange={(e) => updateRule(row._clientId, 'matchKey', e.target.value)}
          placeholder={row.ruleType === 'BODY_JSON_PATH'
            ? t('components.mockEndpointEditor.jsonPathPlaceholder')
            : t('components.mockEndpointEditor.keyPathPlaceholder')}
        />
      ),
    },
    {
      title: t('components.mockEndpointEditor.valueOptional'),
      render: (_: unknown, row: RuleRow) => (
        <Input
          size="small"
          value={row.matchValue}
          onChange={(e) => updateRule(row._clientId, 'matchValue', e.target.value)}
          placeholder={t('components.mockEndpointEditor.expectedValuePlaceholder')}
        />
      ),
    },
    {
      title: '',
      width: 40,
      render: (_: unknown, row: RuleRow) => (
        <Button
          size="small"
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => setMatchRules((prev) => prev.filter((r) => r._clientId !== row._clientId))}
        />
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 200px' }}>
          <div style={fieldLabel}>{t('components.mockEndpointEditor.nameLabel')}</div>
          <Input size="small" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('components.mockEndpointEditor.endpointNamePlaceholder')} />
        </div>
        <div style={{ flex: '0 0 100px' }}>
          <div style={fieldLabel}>{t('components.mockEndpointEditor.methodLabel')}</div>
          <Select
            size="small"
            value={httpMethod}
            onChange={setHttpMethod}
            style={{ width: '100%' }}
            options={HTTP_METHODS.map((m) => ({
              value: m,
              label: <span style={{ color: METHOD_COLORS[m], fontWeight: 600 }}>{m}</span>,
            }))}
          />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={fieldLabel}>{t('components.mockEndpointEditor.pathLabel')}</div>
          <Input size="small" value={pathPattern} onChange={(e) => setPathPattern(e.target.value)} placeholder={t('components.mockEndpointEditor.pathPlaceholder')} />
        </div>
        <div>
          <div style={fieldLabel}>{t('components.mockEndpointEditor.enabledLabel')}</div>
          <Switch size="small" checked={enabled} onChange={setEnabled} />
        </div>
      </div>

      <Tabs
        size="small"
        items={[
          {
            key: 'response',
            label: t('components.mockEndpointEditor.tabResponse'),
            children: (
              <div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <div style={{ flex: '0 0 100px' }}>
                    <div style={fieldLabel}>{t('components.mockEndpointEditor.statusCodeLabel')}</div>
                    <InputNumber
                      size="small"
                      value={responseStatus}
                      onChange={(v) => setResponseStatus(v ?? 200)}
                      min={100}
                      max={599}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
                <div style={fieldLabel}>{t('components.mockEndpointEditor.responseBodyLabel')}</div>
                <TextArea
                  size="small"
                  value={responseBody}
                  onChange={(e) => setResponseBody(e.target.value)}
                  rows={6}
                  placeholder={t('components.mockEndpointEditor.responseBodyPlaceholder')}
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
                <div style={{ ...fieldLabel, marginTop: 12 }}>{t('components.mockEndpointEditor.responseHeadersLabel')}</div>
                <Table
                  rowKey="_clientId"
                  dataSource={responseHeaders}
                  columns={headerColumns}
                  size="small"
                  pagination={false}
                  style={{ marginBottom: 8 }}
                />
                <Button
                  type="dashed"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => setResponseHeaders((prev) => [...prev, { _clientId: genId(), key: '', value: '' }])}
                  style={{ color: '#1677ff', borderColor: '#1677ff' }}
                >
                  {t('components.mockEndpointEditor.addHeader')}
                </Button>
              </div>
            ),
          },
          {
            key: 'rules',
            label: t('components.mockEndpointEditor.tabMatchRules', { count: matchRules.length }),
            children: (
              <div>
                <div style={{ color: '#8c8c8c', fontSize: 12, marginBottom: 8 }}>
                  {t('components.mockEndpointEditor.matchRulesHint')}
                </div>
                <Table
                  rowKey="_clientId"
                  dataSource={matchRules}
                  columns={ruleColumns}
                  size="small"
                  pagination={false}
                  style={{ marginBottom: 8 }}
                />
                <Button
                  type="dashed"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => setMatchRules((prev) => [
                    ...prev,
                    { _clientId: genId(), ruleType: 'HEADER', matchKey: '', matchValue: '' },
                  ])}
                  style={{ color: '#597ef7', borderColor: '#597ef7' }}
                >
                  {t('components.mockEndpointEditor.addRule')}
                </Button>
              </div>
            ),
          },
          {
            key: 'settings',
            label: t('components.mockEndpointEditor.tabSettings'),
            children: (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: '0 0 120px' }}>
                  <div style={fieldLabel}>{t('components.mockEndpointEditor.delayLabel')}</div>
                  <InputNumber
                    size="small"
                    value={delayMs}
                    onChange={(v) => setDelayMs(v ?? 0)}
                    min={0}
                    max={30000}
                    style={{ width: '100%' }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={fieldLabel}>{t('components.mockEndpointEditor.descriptionLabel')}</div>
                  <TextArea
                    size="small"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    placeholder={t('components.mockEndpointEditor.descriptionPlaceholder')}
                  />
                </div>
              </div>
            ),
          },
        ]}
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
        <Button size="small" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button size="small" type="primary" onClick={handleSave} loading={saving}>
          {isNew ? t('common.create') : t('common.save')}
        </Button>
      </div>
    </div>
  )
}
