import { useCallback, useEffect, useMemo, useState, type ReactNode, type Key } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Button,
  Dropdown,
  Empty,
  Input,
  Modal,
  Form,
  Select,
  Spin,
  Tree,
  message,
} from 'antd'
import type { DataNode, EventDataNode } from 'antd/es/tree'
import type { MenuProps } from 'antd'
import {
  PlusOutlined,
  SearchOutlined,
  MoreOutlined,
} from '@ant-design/icons'
import { useProjectContext } from '../context/ProjectContext'
import { collectionApi } from '../services/projectApi'
import { testSuiteApi } from '../services/testSuiteApi'
import type { TestSuite } from '../types/testSuite'
import { useRunCollection } from './RunCollectionModal'

type TreeKey = string

function collectionKey(id: string): TreeKey {
  return `collection:${id}`
}

function suiteKey(id: string): TreeKey {
  return `suite:${id}`
}

function parseKey(key: TreeKey): { type: 'collection' | 'suite'; id: string } | null {
  if (key.startsWith('collection:')) return { type: 'collection', id: key.slice('collection:'.length) }
  if (key.startsWith('suite:')) return { type: 'suite', id: key.slice('suite:'.length) }
  return null
}

export default function SuiteExplorer() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const {
    projectId,
    projects,
    collections,
    collectionId,
    setProjectId,
    setCollectionId,
    effectiveCollectionId,
    refreshCollections,
    suiteTreeVersion,
    bumpSuiteTree,
    loading: projectLoading,
  } = useProjectContext()

  const [suites, setSuites] = useState<TestSuite[]>([])
  const [loadingSuites, setLoadingSuites] = useState(false)
  const [query, setQuery] = useState('')
  const [expandedKeys, setExpandedKeys] = useState<TreeKey[]>([])
  const [collectionModalOpen, setCollectionModalOpen] = useState(false)
  const [savingCollection, setSavingCollection] = useState(false)
  const [collectionForm] = Form.useForm()
  const { openRunCollection, modal: runCollectionModal, running: runningCollection } = useRunCollection()

  const activeSuiteId = useMemo(() => {
    const match = location.pathname.match(/^\/test-suites\/([^/]+)/)
    if (!match || match[1] === 'new') return null
    return match[1]
  }, [location.pathname])

  const loadSuites = useCallback(async () => {
    if (!projectId) {
      setSuites([])
      return
    }
    setLoadingSuites(true)
    try {
      const page = await testSuiteApi.list({
        projectId,
        page: 0,
        size: 200,
        sortBy: 'name',
        sortDir: 'asc',
      })
      setSuites(page.content)
    } catch {
      message.error(t('components.suiteExplorer.failedLoadSuites'))
    } finally {
      setLoadingSuites(false)
    }
  }, [projectId, t])

  useEffect(() => {
    loadSuites()
  }, [loadSuites, suiteTreeVersion])

  // Keep parents expanded when collections change / suite is active
  useEffect(() => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      collections.forEach((c) => next.add(collectionKey(c.id)))
      if (collectionId) next.add(collectionKey(collectionId))
      const activeSuite = suites.find((s) => s.id === activeSuiteId)
      if (activeSuite) next.add(collectionKey(activeSuite.collectionId))
      return [...next]
    })
  }, [collections, collectionId, activeSuiteId, suites])

  const filteredSuites = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return suites
    return suites.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q),
    )
  }, [suites, query])

  const filteredCollections = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return collections
    const suiteCollectionIds = new Set(filteredSuites.map((s) => s.collectionId))
    return collections.filter(
      (c) => c.name.toLowerCase().includes(q) || suiteCollectionIds.has(c.id),
    )
  }, [collections, filteredSuites, query])

  const treeData: DataNode[] = useMemo(() => {
    return filteredCollections.map((c) => {
      const children = filteredSuites
        .filter((s) => s.collectionId === c.id)
        .map((s) => ({
          key: suiteKey(s.id),
          title: s.name,
          isLeaf: true,
          className: 'explorer-suite-node',
        }))
      return {
        key: collectionKey(c.id),
        title: (
          <span className="explorer-group-title">
            <span className="explorer-group-name">{c.name}</span>
            <span className="explorer-group-count">{children.length}</span>
          </span>
        ),
        children,
        className: 'explorer-collection-node',
      }
    })
  }, [filteredCollections, filteredSuites])

  const selectedKeys = useMemo(() => {
    if (activeSuiteId) return [suiteKey(activeSuiteId)]
    if (collectionId) return [collectionKey(collectionId)]
    return []
  }, [activeSuiteId, collectionId])

  const handleSelect = (
    _keys: Key[],
    info: { node: EventDataNode<DataNode> },
  ) => {
    const parsed = parseKey(String(info.node.key))
    if (!parsed) return
    if (parsed.type === 'collection') {
      setCollectionId(parsed.id)
      navigate('/test-suites')
      return
    }
    setCollectionId(
      suites.find((s) => s.id === parsed.id)?.collectionId ?? collectionId,
    )
    navigate(`/test-suites/${parsed.id}`)
  }

  const handleCreateCollection = async () => {
    if (!projectId) return
    try {
      const values = await collectionForm.validateFields()
      setSavingCollection(true)
      const created = await collectionApi.create({
        projectId,
        name: values.name,
        description: values.description ?? '',
      })
      message.success(t('components.suiteExplorer.collectionCreated'))
      setCollectionModalOpen(false)
      collectionForm.resetFields()
      await refreshCollections()
      setCollectionId(created.id)
      bumpSuiteTree()
      setExpandedKeys((prev) => [...new Set([...prev, collectionKey(created.id)])])
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        message.error(axiosErr.response?.data?.error ?? t('components.suiteExplorer.failedCreateCollection'))
      } else {
        message.error(t('components.suiteExplorer.failedCreateCollection'))
      }
    } finally {
      setSavingCollection(false)
    }
  }

  const newSuiteInCollection = (cid: string) => {
    setCollectionId(cid)
    navigate('/test-suites/new')
  }

  const suiteCountForCollection = (cid: string) => {
    const collection = collections.find((c) => c.id === cid)
    if (collection) return collection.suiteCount
    return suites.filter((s) => s.collectionId === cid).length
  }

  const runCollection = (cid: string) => {
    const collection = collections.find((c) => c.id === cid)
    if (!collection) return
    openRunCollection({
      id: cid,
      name: collection.name,
      suiteCount: suiteCountForCollection(cid),
    })
  }

  const handleDeleteCollection = (cid: string) => {
    const collection = collections.find((c) => c.id === cid)
    if (!collection || collection.isDefault) return
    const suiteCount = suiteCountForCollection(cid)
    Modal.confirm({
      title: t('components.suiteExplorer.deleteCollectionTitle'),
      content:
        suiteCount > 0
          ? t('components.suiteExplorer.deleteCollectionWithSuites', { count: suiteCount })
          : t('components.suiteExplorer.deleteCollectionConfirm'),
      okText: t('common.delete'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await collectionApi.delete(cid)
          message.success(t('components.suiteExplorer.collectionDeleted'))
          if (collectionId === cid) {
            setCollectionId(null)
          }
          await refreshCollections()
          bumpSuiteTree()
          if (activeSuiteId && suites.some((s) => s.id === activeSuiteId && s.collectionId === cid)) {
            navigate('/test-suites')
          }
        } catch (err: unknown) {
          if (err && typeof err === 'object' && 'response' in err) {
            const axiosErr = err as { response?: { data?: { error?: string } } }
            message.error(axiosErr.response?.data?.error ?? t('components.suiteExplorer.failedDeleteCollection'))
          } else {
            message.error(t('components.suiteExplorer.failedDeleteCollection'))
          }
          throw err
        }
      },
    })
  }

  const collectionMenu = (cid: string): MenuProps => {
    const collection = collections.find((c) => c.id === cid)
    return {
      items: [
        {
          key: 'new-suite',
          label: t('components.suiteExplorer.newSuite'),
          onClick: () => newSuiteInCollection(cid),
        },
        {
          key: 'run-collection',
          label: t('components.suiteExplorer.runCollection'),
          disabled: runningCollection,
          onClick: () => runCollection(cid),
        },
        {
          type: 'divider',
        },
        {
          key: 'delete-collection',
          label: t('common.delete'),
          danger: true,
          disabled: collection?.isDefault,
          onClick: () => handleDeleteCollection(cid),
        },
      ],
    }
  }

  const toolbarMenu: MenuProps = {
    items: [
      {
        key: 'new-collection',
        label: t('components.suiteExplorer.newCollection'),
        disabled: !projectId,
        onClick: () => {
          collectionForm.resetFields()
          setCollectionModalOpen(true)
        },
      },
      {
        key: 'new-suite',
        label: t('components.suiteExplorer.newSuite'),
        disabled: !effectiveCollectionId,
        onClick: () => navigate('/test-suites/new'),
      },
      {
        key: 'import',
        label: t('components.suiteExplorer.importSuite'),
        onClick: () => navigate('/test-suites?import=1'),
      },
    ],
  }

  const titleRender = (node: DataNode) => {
    const parsed = parseKey(String(node.key))
    if (parsed?.type === 'collection') {
      return (
        <span className="explorer-node-row">
          <span className="explorer-node-label">{node.title as ReactNode}</span>
          <Dropdown menu={collectionMenu(parsed.id)} trigger={['click']}>
            <Button
              type="text"
              size="small"
              className="explorer-node-action"
              icon={<MoreOutlined />}
              onClick={(e) => e.stopPropagation()}
              aria-label={t('components.suiteExplorer.collectionActions')}
            />
          </Dropdown>
        </span>
      )
    }
    return <span className="explorer-node-label">{node.title as ReactNode}</span>
  }

  return (
    <div className="suite-explorer">
      <div className="suite-explorer-header">
        <Select
          size="small"
          className="suite-explorer-project"
          loading={projectLoading}
          value={projectId ?? undefined}
          placeholder={t('components.suiteExplorer.project')}
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(value) => setProjectId(value)}
          aria-label={t('components.suiteExplorer.currentProject')}
        />
        <Dropdown menu={toolbarMenu} trigger={['click']}>
          <Button size="small" type="text" icon={<PlusOutlined />} aria-label={t('components.suiteExplorer.create')} />
        </Dropdown>
      </div>

      <div className="suite-explorer-search">
        <Input
          size="small"
          allowClear
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
          placeholder={t('components.suiteExplorer.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="suite-explorer-tree">
        {loadingSuites ? (
          <div className="suite-explorer-empty">
            <Spin size="small" />
          </div>
        ) : treeData.length === 0 ? (
          <div className="suite-explorer-empty">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={query ? t('components.suiteExplorer.noMatches') : t('components.suiteExplorer.noCollectionsYet')}
            >
              {!query && (
                <Button
                  size="small"
                  type="primary"
                  disabled={!projectId}
                  onClick={() => setCollectionModalOpen(true)}
                >
                  {t('components.suiteExplorer.newCollection')}
                </Button>
              )}
            </Empty>
          </div>
        ) : (
          <Tree
            showIcon={false}
            blockNode
            treeData={treeData}
            expandedKeys={expandedKeys}
            selectedKeys={selectedKeys}
            onExpand={(keys) => setExpandedKeys(keys.map(String))}
            onSelect={handleSelect}
            titleRender={titleRender}
            className="suite-explorer-antd-tree"
          />
        )}
      </div>

      <Modal
        title={t('components.suiteExplorer.newCollection')}
        open={collectionModalOpen}
        onOk={handleCreateCollection}
        onCancel={() => setCollectionModalOpen(false)}
        confirmLoading={savingCollection}
        okText={t('common.create')}
        destroyOnClose
      >
        <Form form={collectionForm} layout="vertical" requiredMark="optional">
          <Form.Item
            name="name"
            label={t('common.name')}
            rules={[{ required: true, message: t('components.suiteExplorer.nameRequired') }]}
            extra={t('components.suiteExplorer.nameExtra')}
          >
            <Input maxLength={200} placeholder={t('components.suiteExplorer.namePlaceholder')} autoFocus />
          </Form.Item>
          <Form.Item name="description" label={t('common.description')} extra={t('components.suiteExplorer.descriptionExtra')}>
            <Input.TextArea rows={2} maxLength={2000} placeholder={t('components.suiteExplorer.descriptionPlaceholder')} autoSize={{ minRows: 2, maxRows: 4 }} />
          </Form.Item>
        </Form>
      </Modal>

      {runCollectionModal}
    </div>
  )
}
