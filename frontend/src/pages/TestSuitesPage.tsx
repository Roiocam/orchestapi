import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
  Empty,
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
  PlayCircleOutlined,
} from '@ant-design/icons'
import type { FilterDropdownProps } from 'antd/es/table/interface'
import type { TestSuite, TestSuiteListParams } from '../types/testSuite'
import type { PageResponse } from '../types/environment'
import { testSuiteApi, exportSuite } from '../services/testSuiteApi'
import { useProjectContext } from '../context/ProjectContext'
import { useRunCollection } from '../components/RunCollectionModal'
import { formatDateTime } from '../utils/datetime'

function testSuiteColumnLabel(dataIndex: string, t: (key: string) => string): string {
  if (dataIndex === 'name') return t('pages.testSuites.columnName')
  return dataIndex
}

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

  const columnLabel = testSuiteColumnLabel(dataIndex, t)

  return (
    <div style={{ padding: 8 }} onKeyDown={(e) => e.stopPropagation()}>
      <Input
        ref={inputRef}
        placeholder={t('common.searchColumn', { column: columnLabel })}
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

export default function TestSuitesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const {
    projectId,
    collectionId,
    collections,
    effectiveCollectionId,
    refreshCollections,
    bumpSuiteTree,
  } = useProjectContext()

  const selectedCollection = collections.find((c) => c.id === collectionId) ?? null

  const [data, setData] = useState<PageResponse<TestSuite>>({
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

  const [renameModalOpen, setRenameModalOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [pendingImport, setPendingImport] = useState<Record<string, unknown> | null>(null)
  const { openRunCollection, modal: runCollectionModal, running: runningCollection } = useRunCollection()

  useEffect(() => {
    if (searchParams.get('import') === '1') {
      fileInputRef.current?.click()
      searchParams.delete('import')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!projectId) {
        setData({
          content: [],
          page: 0,
          size: pageSize,
          totalElements: 0,
          totalPages: 0,
        })
        return
      }
      setLoading(true)
      try {
        const params: TestSuiteListParams = {
          page: currentPage - 1,
          size: pageSize,
          sortBy,
          sortDir,
          projectId,
        }
        if (collectionId) params.collectionId = collectionId
        if (appliedFilters.name) params.name = appliedFilters.name

        const result = await testSuiteApi.list(params)
        if (!cancelled) setData(result)
      } catch {
        if (!cancelled) message.error(t('pages.testSuites.failedLoad'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [currentPage, pageSize, sortBy, sortDir, appliedFilters, refreshKey, projectId, collectionId])

  useEffect(() => {
    setCurrentPage(1)
  }, [projectId, collectionId])

  const handleDelete = async (id: string) => {
    try {
      await testSuiteApi.delete(id)
      message.success(t('pages.testSuites.deleted'))
      setRefreshKey((k) => k + 1)
      bumpSuiteTree()
      await refreshCollections()
    } catch {
      message.error(t('pages.testSuites.failedDelete'))
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

  const doImport = async (importData: Record<string, unknown>) => {
    try {
      const payload = {
        ...importData,
        collectionId: effectiveCollectionId ?? undefined,
      }
      await testSuiteApi.importSuite(payload)
      message.success(t('pages.testSuites.imported', { name: importData.name }))
      setPendingImport(null)
      setRefreshKey((k) => k + 1)
      bumpSuiteTree()
      await refreshCollections()
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        const errorMsg = axiosErr.response?.data?.error ?? ''
        if (errorMsg.toLowerCase().includes('already exists')) {
          setPendingImport(importData)
          setRenameValue(importData.name as string)
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
    const reader = new FileReader()
    reader.onerror = () => message.error(t('common.failedReadFile'))
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string)
        if (!parsed.name) {
          message.error(t('pages.testSuites.invalidFile'))
          return
        }
        await doImport(parsed)
      } catch (err) {
        if (err instanceof SyntaxError) {
          message.error(t('common.invalidJson'))
        } else {
          message.error(t('common.importFailed'))
        }
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleRenameImport = async () => {
    if (!pendingImport || !renameValue.trim()) return
    const trimmedName = renameValue.trim()
    setRenameModalOpen(false)
    await doImport({ ...pendingImport, name: trimmedName })
  }

  const handleExport = async (id: string) => {
    try {
      await exportSuite(id)
      message.success(t('pages.testSuites.exported'))
    } catch {
      message.error(t('pages.testSuites.failedExport'))
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
      width: 64,
      render: (_: unknown, __: TestSuite, index: number) => (
        <span style={{ color: '#888' }}>{(currentPage - 1) * pageSize + index + 1}</span>
      ),
    },
    {
      title: t('pages.testSuites.columnName'),
      dataIndex: 'name',
      key: 'name',
      sorter: true,
      sortOrder: sortBy === 'name' ? (sortDir === 'asc' ? ('ascend' as const) : ('descend' as const)) : null,
      ...columnSearchProps('name'),
      render: (name: string) => <strong>{name}</strong>,
    },
    {
      title: t('pages.testSuites.steps'),
      dataIndex: 'stepCount',
      key: 'stepCount',
      width: 80,
      render: (stepCount: number) => <Tag>{stepCount}</Tag>,
    },
    {
      title: t('pages.testSuites.updated'),
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 160,
      sorter: true,
      sortOrder:
        sortBy === 'updatedAt' ? (sortDir === 'asc' ? ('ascend' as const) : ('descend' as const)) : null,
      render: (date: string) => formatDateTime(date),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 140,
      render: (_: unknown, record: TestSuite) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Space>
            <Tooltip title={t('common.edit')}>
              <Button
                type="text"
                icon={<EditOutlined />}
                onClick={() => navigate(`/test-suites/${record.id}`)}
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
              title={t('pages.testSuites.deleteConfirm')}
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
    <div className="suites-workbench">
      <div className="suites-workbench-toolbar">
        <div className="suites-workbench-crumb">
          {selectedCollection ? (
            <>
              <span>{selectedCollection.name}</span>
              <Tag>{data.totalElements}</Tag>
            </>
          ) : (
            <>
              <span>{t('pages.testSuites.allCollections')}</span>
              <Tag>{data.totalElements}</Tag>
            </>
          )}
        </div>
        <Space>
          <Button icon={<ImportOutlined />} onClick={() => fileInputRef.current?.click()}>
            {t('common.import')}
          </Button>
          {selectedCollection && (
            <Button
              icon={<PlayCircleOutlined />}
              loading={runningCollection}
              onClick={() =>
                openRunCollection({
                  id: selectedCollection.id,
                  name: selectedCollection.name,
                  suiteCount: selectedCollection.suiteCount ?? data.totalElements,
                })
              }
            >
              {t('pages.testSuites.runCollection')}
            </Button>
          )}
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/test-suites/new')}
            disabled={!effectiveCollectionId}
          >
            {t('pages.testSuites.newSuite')}
          </Button>
        </Space>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleImport}
        aria-label={t('pages.testSuites.importFileLabel')}
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
          setPendingImport(null)
        }}
        okText={t('common.import')}
      >
        <p>
          {t('pages.testSuites.renameBody', { name: pendingImport?.name as string })}
        </p>
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          placeholder={t('pages.testSuites.renamePlaceholder')}
          onPressEnter={handleRenameImport}
          autoFocus
        />
      </Modal>

      {activeFilterEntries.length > 0 && (
        <div className="suites-filter-bar">
          <span style={{ color: '#888', fontSize: 13 }}>{t('common.filters')}</span>
          {activeFilterEntries.map(([key, value]) => (
            <Tag key={key} closable onClose={() => handleResetFilter(key)} color="blue">
              {testSuiteColumnLabel(key, t)}: {value}
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

      <Table
        columns={columns}
        dataSource={data.content}
        rowKey="id"
        loading={loading}
        className="suites-table"
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                selectedCollection
                  ? t('pages.testSuites.emptyCollection')
                  : t('pages.testSuites.emptyDefault')
              }
            />
          ),
        }}
        onRow={(record) => ({
          onClick: () => navigate(`/test-suites/${record.id}`),
          style: { cursor: 'pointer' },
        })}
        pagination={{
          current: currentPage,
          pageSize,
          total: data.totalElements,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50'],
          showTotal: (total, range) => t('common.pagination', { from: range[0], to: range[1], total }),
        }}
        onChange={(pagination, _filters, sorter) => {
          setCurrentPage(pagination.current ?? 1)
          setPageSize(pagination.pageSize ?? 10)
          if (!Array.isArray(sorter)) {
            if (sorter.field && sorter.order) {
              setSortBy(sorter.field as string)
              setSortDir(sorter.order === 'descend' ? 'desc' : 'asc')
            } else {
              setSortBy('name')
              setSortDir('asc')
            }
          }
        }}
      />

      {runCollectionModal}
    </div>
  )
}
