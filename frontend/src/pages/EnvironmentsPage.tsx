import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Table,
  Button,
  Space,
  Popconfirm,
  Tag,
  message,
  Tooltip,
  Modal,
  Input,
} from 'antd'
import type { InputRef } from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ExportOutlined,
  ImportOutlined,
  SearchOutlined,
  WarningOutlined,
  CloseCircleFilled,
} from '@ant-design/icons'
import type { FilterDropdownProps } from 'antd/es/table/interface'
import type {
  Environment,
  PageResponse,
} from '../types/environment'
import { environmentApi, type EnvironmentListParams } from '../services/environmentApi'


function columnLabel(dataIndex: string, t: (key: string) => string): string {
  if (dataIndex === 'name') return t('pages.environments.columnName')
  if (dataIndex === 'baseUrl') return t('pages.environments.columnBaseUrl')
  return dataIndex
}

// Removed: old client-side exportEnvironment — now uses backend GET /export

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

export default function EnvironmentsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [data, setData] = useState<PageResponse<Environment>>({
    content: [],
    page: 0,
    size: 10,
    totalElements: 0,
    totalPages: 0,
  })
  const [loading, setLoading] = useState(false)
  const [appliedFilters, setAppliedFilters] = useState<Record<string, string>>({})
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [sortBy, setSortBy] = useState('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const params: EnvironmentListParams = {
          page: currentPage - 1,
          size: pageSize,
          sortBy,
          sortDir,
        }
        if (appliedFilters.name) params.name = appliedFilters.name
        if (appliedFilters.baseUrl) params.baseUrl = appliedFilters.baseUrl

        const result = await environmentApi.list(params)
        if (!cancelled) setData(result)
      } catch {
        if (!cancelled) message.error(t('pages.environments.failedLoad'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [currentPage, pageSize, sortBy, sortDir, appliedFilters, refreshKey])

  const handleDelete = async (id: string) => {
    try {
      await environmentApi.delete(id)
      message.success(t('pages.environments.deleted'))
      setRefreshKey((k) => k + 1)
    } catch {
      message.error(t('pages.environments.failedDelete'))
    }
  }

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
    setCurrentPage(1)
  }

  // --- Import logic (via backend API) ---
  const [renameModalOpen, setRenameModalOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null)
  const [pendingImportName, setPendingImportName] = useState('')

  const doImportFile = async (file: File, overrideName?: string) => {
    try {
      const uploadFile = overrideName
        ? new File([file], overrideName + (file.name.endsWith('.zip') ? '.zip' : '.json'), { type: file.type })
        : file
      const result = await environmentApi.importEnvironment(uploadFile)
      message.success(t('pages.environments.imported', { name: result.environment.name }))
      if (result.warnings?.length) {
        result.warnings.forEach((w) => message.warning(w, 5))
      }
      setPendingImportFile(null)
      setPendingImportName('')
      setRefreshKey((k) => k + 1)
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        const errorMsg = axiosErr.response?.data?.error ?? ''
        if (errorMsg.toLowerCase().includes('already exists')) {
          setPendingImportFile(file)
          // Try to extract the name from the error message
          const nameMatch = errorMsg.match(/name '([^']+)'/)
          setPendingImportName(nameMatch ? nameMatch[1] : file.name.replace(/\.(json|zip)$/i, ''))
          setRenameValue(nameMatch ? nameMatch[1] : '')
          setRenameModalOpen(true)
        } else {
          message.error(errorMsg || t('common.importFailed'))
        }
      } else {
        message.error(t('common.importFailed'))
      }
    }
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    doImportFile(file)
    e.target.value = ''
  }

  const handleRenameImport = async () => {
    if (!pendingImportFile || !renameValue.trim()) return
    const trimmedName = renameValue.trim()
    setRenameModalOpen(false)
    // For rename: we need to re-read manifest and change name.
    // Easiest approach: read the file, modify manifest name, re-upload.
    try {
      if (pendingImportFile.name.toLowerCase().endsWith('.zip')) {
        // For zip files, we can't easily modify in-browser. Show a message.
        message.info(t('pages.environments.renameZipHint'))
        setPendingImportFile(null)
        return
      }
      const text = await pendingImportFile.text()
      const parsed = JSON.parse(text)
      parsed.name = trimmedName
      const newBlob = new Blob([JSON.stringify(parsed, null, 2)], { type: 'application/json' })
      const newFile = new File([newBlob], pendingImportFile.name, { type: 'application/json' })
      await doImportFile(newFile)
    } catch {
      message.error(t('common.importFailed'))
    }
  }

  const handleExport = async (envId: string) => {
    try {
      await environmentApi.exportEnvironment(envId)
    } catch {
      message.error(t('pages.environments.failedExport'))
    }
  }

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

  const activeFilterEntries = Object.entries(appliedFilters).filter(([, v]) => v)

  const columns = [
    {
      title: t('common.sno'),
      key: 'sno',
      width: 70,
      render: (_: unknown, __: Environment, index: number) => (
        <span style={{ color: '#888' }}>{(currentPage - 1) * pageSize + index + 1}</span>
      ),
    },
    {
      title: t('pages.environments.columnName'),
      dataIndex: 'name',
      key: 'name',
      sorter: true,
      sortOrder: sortBy === 'name' ? (sortDir === 'asc' ? ('ascend' as const) : ('descend' as const)) : null,
      ...columnSearchProps('name'),
      render: (name: string) => <strong>{name}</strong>,
    },
    {
      title: t('pages.environments.columnBaseUrl'),
      dataIndex: 'baseUrl',
      key: 'baseUrl',
      ellipsis: true,
      sorter: true,
      sortOrder: sortBy === 'baseUrl' ? (sortDir === 'asc' ? ('ascend' as const) : ('descend' as const)) : null,
      ...columnSearchProps('baseUrl'),
    },
    {
      title: t('pages.environments.variables'),
      dataIndex: 'variables',
      key: 'variables',
      width: 100,
      render: (vars: Environment['variables']) => (
        <Space>
          <Tag>{vars.length}</Tag>
          {vars.some((v) => v.secret) && <Tag color="orange">{t('pages.environments.secrets')}</Tag>}
        </Space>
      ),
    },
    {
      title: t('pages.environments.headers'),
      dataIndex: 'headers',
      key: 'headers',
      width: 80,
      render: (hdrs: Environment['headers']) => <Tag>{hdrs.length}</Tag>,
    },
    {
      title: t('pages.environments.oauth'),
      key: 'oauth',
      width: 120,
      render: (_: unknown, record: Environment) => (
        <Space size={4}>
          <Tag color={record.oauth?.enabled ? 'green' : undefined}>
            {record.oauth?.enabled ? t('pages.environments.enabled') : t('pages.environments.disabled')}
          </Tag>
          {record.oauth?.clientSecretConfigured && <Tag color="orange">{t('pages.environments.secret')}</Tag>}
        </Space>
      ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 160,
      render: (_: unknown, record: Environment) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Space>
            <Tooltip title={t('common.edit')}>
              <Button
                type="text"
                icon={<EditOutlined />}
                onClick={() => navigate(`/environments/${record.id}`)}
              />
            </Tooltip>
            <Tooltip title={t('common.export')}>
              <Button
                type="text"
                icon={<ExportOutlined />}
                onClick={() => handleExport(record.id)}
              />
            </Tooltip>
            <Popconfirm
              title={t('pages.environments.deleteConfirm')}
              onConfirm={() => handleDelete(record.id)}
              okText={t('common.delete')}
              okType="danger"
            >
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        </div>
      ),
    },
  ]

  return (
    <div>
      <div className="page-header">
        <div className="page-header-copy">
          <div className="page-header-kicker">{t('pages.environments.kicker')}</div>
          <h1 className="page-header-title">{t('pages.environments.title')}</h1>
          <p className="page-header-desc">
            {t('pages.environments.description')}
          </p>
        </div>
        <div className="page-header-actions">
          <Button icon={<ImportOutlined />} onClick={() => fileInputRef.current?.click()}>
            {t('common.import')}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/environments/new')}
          >
            {t('pages.environments.newEnvironment')}
          </Button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.zip"
        style={{ display: 'none' }}
        onChange={handleImport}
        aria-label={t('pages.environments.importFileLabel')}
      />

      <Modal
        title={
          <Space>
            <WarningOutlined style={{ color: '#faad14' }} />
            {t('common.renameTitle')}
          </Space>
        }
        open={renameModalOpen}
        onOk={handleRenameImport}
        onCancel={() => {
          setRenameModalOpen(false)
          setPendingImportFile(null)
        }}
        okText={t('common.import')}
      >
        <p style={{ marginBottom: 12, color: 'var(--text-body)' }}>
          {t('pages.environments.renameBody', { name: pendingImportName })}
        </p>
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          placeholder={t('pages.environments.renamePlaceholder')}
          onPressEnter={handleRenameImport}
          autoFocus
        />
      </Modal>

      {activeFilterEntries.length > 0 && (
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
          {activeFilterEntries.length > 1 && (
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

      <div className="product-panel">
      <Table
        columns={columns}
        dataSource={data.content}
        rowKey="id"
        loading={loading}
        onRow={(record) => ({
          onClick: () => navigate(`/environments/${record.id}`),
          style: { cursor: 'pointer' },
        })}
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
              // Sort cleared — reset to default
              setSortBy('name')
              setSortDir('asc')
            }
          }
        }}
      />
      </div>
    </div>
  )
}
