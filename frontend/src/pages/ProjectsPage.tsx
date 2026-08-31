import { useEffect, useState } from 'react'
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

export default function ProjectsPage() {
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
      message.error('Failed to load projects')
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
        message.success('Project updated')
      } else {
        const created = await projectApi.create(values)
        message.success('Project created')
        setProjectId(created.id)
      }
      setModalOpen(false)
      await load()
      await refreshProjects()
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        message.error(axiosErr.response?.data?.error ?? 'Failed to save project')
      } else {
        message.error('Failed to save project')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (project: Project) => {
    try {
      await projectApi.delete(project.id)
      message.success('Project deleted')
      if (projectId === project.id) {
        await refreshProjects()
      } else {
        await load()
        await refreshProjects()
      }
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        message.error(axiosErr.response?.data?.error ?? 'Failed to delete project')
      } else {
        message.error('Failed to delete project')
      }
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          New Project
        </Button>
      </div>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={data}
        style={{ background: '#fff', borderRadius: 8, padding: '0 0 8px' }}
        pagination={false}
        columns={[
          {
            title: 'Name',
            dataIndex: 'name',
            render: (name: string, record: Project) => (
              <Space>
                <strong>{name}</strong>
                {record.isDefault && <Tag>Default</Tag>}
              </Space>
            ),
          },
          {
            title: 'Collections',
            dataIndex: 'collectionCount',
            width: 120,
            render: (count: number) => <Tag>{count}</Tag>,
          },
          {
            title: 'Updated',
            dataIndex: 'updatedAt',
            width: 180,
            render: (date: string) => new Date(date).toLocaleString(),
          },
          {
            title: 'Actions',
            key: 'actions',
            width: 120,
            render: (_: unknown, record: Project) => (
              <Space>
                <Tooltip title="Edit">
                  <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(record)} />
                </Tooltip>
                <Popconfirm
                  title="Delete this project?"
                  description="Only empty projects can be deleted."
                  disabled={record.isDefault}
                  onConfirm={() => handleDelete(record)}
                  okText="Delete"
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

      <Modal
        title={editing ? 'Edit Project' : 'New Project'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText={editing ? 'Save' : 'Create'}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: 'Name is required' }]}
          >
            <Input maxLength={200} placeholder="e.g. Agent Platform" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} maxLength={2000} placeholder="Optional" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
