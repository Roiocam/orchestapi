import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Form, Modal, Select, message } from 'antd'
import { PlayCircleOutlined } from '@ant-design/icons'
import { environmentApi } from '../services/environmentApi'
import { collectionApi } from '../services/projectApi'

export interface RunCollectionTarget {
  id: string
  name: string
  suiteCount: number
}

function formatRunMessage(succeeded: number, failed: number): void {
  if (failed === 0) {
    message.success(
      `Collection run completed: ${succeeded} suite${succeeded === 1 ? '' : 's'} succeeded`,
    )
    return
  }
  if (succeeded === 0) {
    message.error(`Collection run failed: ${failed} suite${failed === 1 ? '' : 's'} failed`)
    return
  }
  message.warning(
    `Collection run completed: ${succeeded} succeeded, ${failed} failed`,
  )
}

export function useRunCollection() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [target, setTarget] = useState<RunCollectionTarget | null>(null)
  const [selectedEnvId, setSelectedEnvId] = useState<string | undefined>(undefined)
  const [environments, setEnvironments] = useState<{ label: string; value: string }[]>([])

  const openRunCollection = useCallback((next: RunCollectionTarget) => {
    if (next.suiteCount === 0) {
      message.warning('This collection has no suites to run')
      return
    }
    setTarget(next)
    setSelectedEnvId(undefined)
    setOpen(true)
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    environmentApi
      .list({ page: 0, size: 100 })
      .then((page) => {
        if (!cancelled) {
          setEnvironments(page.content.map((env) => ({ label: env.name, value: env.id })))
        }
      })
      .catch(() => {
        if (!cancelled) message.error('Failed to load environments')
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const close = useCallback(() => {
    if (running) return
    setOpen(false)
  }, [running])

  const confirm = useCallback(async () => {
    if (!target || running) return
    setRunning(true)
    try {
      const result = await collectionApi.run(target.id, selectedEnvId)
      setOpen(false)
      formatRunMessage(result.succeeded, result.failed)
      navigate('/runs')
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        message.error(axiosErr.response?.data?.error ?? 'Failed to run collection')
      } else {
        message.error('Failed to run collection')
      }
    } finally {
      setRunning(false)
    }
  }, [target, selectedEnvId, running, navigate])

  const modal = (
    <Modal
      title="Run Collection"
      open={open}
      onOk={confirm}
      onCancel={close}
      okText="Run"
      confirmLoading={running}
      okButtonProps={{ icon: <PlayCircleOutlined />, disabled: !target || target.suiteCount === 0 }}
      destroyOnClose
    >
      {target && (
        <>
          <div className="form-hint" style={{ marginTop: 0 }}>
            Run all <strong>{target.suiteCount}</strong> suite
            {target.suiteCount === 1 ? '' : 's'} in <strong>{target.name}</strong>.
          </div>
          <Form layout="vertical" requiredMark="optional" style={{ marginTop: 14 }}>
            <Form.Item
              label="Environment"
              extra="Leave empty to use each suite's default when set."
              style={{ marginBottom: 8 }}
            >
              <Select
                showSearch
                allowClear
                placeholder="Select an environment (optional)"
                value={selectedEnvId}
                onChange={(val) => setSelectedEnvId(val)}
                options={environments}
                disabled={running}
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Form>
        </>
      )}
    </Modal>
  )

  return { openRunCollection, modal, running }
}
