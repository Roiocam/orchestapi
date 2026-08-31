import { useCallback, useEffect, useMemo, useState, type ReactNode, type Key } from 'react'
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
      message.error('Failed to load suites for explorer')
    } finally {
      setLoadingSuites(false)
    }
  }, [projectId])

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
      message.success('Collection created')
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
        message.error(axiosErr.response?.data?.error ?? 'Failed to create collection')
      } else {
        message.error('Failed to create collection')
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

  const collectionMenu = (cid: string): MenuProps => ({
    items: [
      {
        key: 'new-suite',
        label: 'New Suite',
        onClick: () => newSuiteInCollection(cid),
      },
      {
        key: 'run-collection',
        label: 'Run Collection',
        disabled: runningCollection,
        onClick: () => runCollection(cid),
      },
    ],
  })

  const toolbarMenu: MenuProps = {
    items: [
      {
        key: 'new-collection',
        label: 'New Collection',
        disabled: !projectId,
        onClick: () => {
          collectionForm.resetFields()
          setCollectionModalOpen(true)
        },
      },
      {
        key: 'new-suite',
        label: 'New Suite',
        disabled: !effectiveCollectionId,
        onClick: () => navigate('/test-suites/new'),
      },
      {
        key: 'import',
        label: 'Import Suite',
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
              aria-label="Collection actions"
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
          placeholder="Project"
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(value) => setProjectId(value)}
          aria-label="Current project"
        />
        <Dropdown menu={toolbarMenu} trigger={['click']}>
          <Button size="small" type="text" icon={<PlusOutlined />} aria-label="Create" />
        </Dropdown>
      </div>

      <div className="suite-explorer-search">
        <Input
          size="small"
          allowClear
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
          placeholder="Search collections & suites"
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
              description={query ? 'No matches' : 'No collections yet'}
            >
              {!query && (
                <Button
                  size="small"
                  type="primary"
                  disabled={!projectId}
                  onClick={() => setCollectionModalOpen(true)}
                >
                  New Collection
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
        title="New Collection"
        open={collectionModalOpen}
        onOk={handleCreateCollection}
        onCancel={() => setCollectionModalOpen(false)}
        confirmLoading={savingCollection}
        okText="Create"
        destroyOnClose
      >
        <Form form={collectionForm} layout="vertical" requiredMark="optional">
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: 'Name is required' }]}
            extra="A group for related suites, e.g. Skills or MCP."
          >
            <Input maxLength={200} placeholder="e.g. Skills" autoFocus />
          </Form.Item>
          <Form.Item name="description" label="Description" extra="Optional context for teammates.">
            <Input.TextArea rows={2} maxLength={2000} placeholder="Optional" autoSize={{ minRows: 2, maxRows: 4 }} />
          </Form.Item>
        </Form>
      </Modal>

      {runCollectionModal}
    </div>
  )
}
