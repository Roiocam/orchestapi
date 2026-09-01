import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Table,
  Button,
  Space,
  Popconfirm,
  Modal,
  Form,
  Input,
  message,
  Tag,
  Tooltip,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import type { Project } from '../types/project'
import { projectApi } from '../services/projectApi'
import { useProjectContext } from '../context/ProjectContext'
import { formatDateTime } from '../utils/datetime'

export default function ProjectsPage() {
  const { t } = useTranslation()
  const { refreshProjects, setProjectId, projectId } = useProjectContext()
  const [data, setData] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      setData(await projectApi.list())
    } catch {
      message.error(t('pages.projects.loadError'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ name: '', description: '' })
    setModalOpen(true)
  }

  const openEdit = (project: Project) => {
    setEditing(project)
    form.setFieldsValue({
      name: project.name,
      description: project.description,
    })
    setModalOpen(true)
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      if (editing) {
        await projectApi.update(editing.id, values)
        message.success(t('pages.projects.updatedSuccess'))
      } else {
        const created = await projectApi.create(values)
        message.success(t('pages.projects.createdSuccess'))
        setProjectId(created.id)
      }
      setModalOpen(false)
      await load()
      await refreshProjects()
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        message.error(axiosErr.response?.data?.error ?? t('pages.projects.saveError'))
      } else {
        message.error(t('pages.projects.saveError'))
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (project: Project) => {
    try {
      await projectApi.delete(project.id)
      message.success(t('pages.projects.deletedSuccess'))
      if (projectId === project.id) {
        await refreshProjects()
      } else {
        await load()
        await refreshProjects()
      }
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        message.error(axiosErr.response?.data?.error ?? t('pages.projects.deleteError'))
      } else {
        message.error(t('pages.projects.deleteError'))
      }
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-copy">
          <div className="page-header-kicker">{t('common.workspace')}</div>
          <h1 className="page-header-title">{t('pages.projects.title')}</h1>
          <p className="page-header-desc">{t('pages.projects.description')}</p>
        </div>
        <div className="page-header-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t('pages.projects.newProject')}
          </Button>
        </div>
      </div>

      <div className="product-panel">
        <Table
          rowKey="id"
          loading={loading}
          dataSource={data}
          pagination={false}
          columns={[
            {
              title: t('common.name'),
              dataIndex: 'name',
              render: (name: string, record: Project) => (
                <Space>
                  <strong>{name}</strong>
                  {record.isDefault && <Tag>{t('common.default')}</Tag>}
                </Space>
              ),
            },
            {
              title: t('pages.projects.collections'),
              dataIndex: 'collectionCount',
              width: 120,
              render: (count: number) => <Tag>{count}</Tag>,
            },
            {
              title: t('common.updated'),
              dataIndex: 'updatedAt',
              width: 180,
              render: (date: string) => formatDateTime(date),
            },
            {
              title: t('common.actions'),
              key: 'actions',
              width: 120,
              render: (_: unknown, record: Project) => (
                <Space>
                  <Tooltip title={t('common.edit')}>
                    <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(record)} />
                  </Tooltip>
                  <Popconfirm
                    title={t('pages.projects.deleteTitle')}
                    description={t('pages.projects.deleteDescription')}
                    disabled={record.isDefault}
                    onConfirm={() => handleDelete(record)}
                    okText={t('common.delete')}
                    okType="danger"
                  >
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      disabled={record.isDefault}
                    />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </div>

      <Modal
        title={editing ? t('pages.projects.editProject') : t('pages.projects.newProject')}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText={editing ? t('common.save') : t('common.create')}
        destroyOnClose
      >
        <Form form={form} layout="vertical" requiredMark="optional">
          <Form.Item
            name="name"
            label={t('common.name')}
            rules={[{ required: true, message: t('pages.projects.nameRequired') }]}
            extra={t('pages.projects.nameExtra')}
          >
            <Input
              maxLength={200}
              placeholder={t('pages.projects.namePlaceholder')}
              autoFocus
            />
          </Form.Item>
          <Form.Item
            name="description"
            label={t('common.description')}
            extra={t('pages.projects.descriptionExtra')}
          >
            <Input.TextArea
              rows={3}
              maxLength={2000}
              placeholder={t('pages.projects.descriptionPlaceholder')}
              autoSize={{ minRows: 2, maxRows: 5 }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
