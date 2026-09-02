import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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

export function useRunCollection() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [target, setTarget] = useState<RunCollectionTarget | null>(null)
  const [selectedEnvId, setSelectedEnvId] = useState<string | undefined>(undefined)
  const [environments, setEnvironments] = useState<{ label: string; value: string }[]>([])

  const openRunCollection = useCallback((next: RunCollectionTarget) => {
    if (next.suiteCount === 0) {
      message.warning(t('components.runCollection.noSuitesToRun'))
      return
    }
    setTarget(next)
    setSelectedEnvId(undefined)
    setOpen(true)
  }, [t])

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
        if (!cancelled) message.error(t('components.runCollection.failedLoadEnvironments'))
      })
    return () => {
      cancelled = true
    }
  }, [open, t])

  const close = useCallback(() => {
    if (running) return
    setOpen(false)
  }, [running])

  const confirm = useCallback(async () => {
    if (!target || running) return
    setRunning(true)
    try {
      const { batchId } = await collectionApi.run(target.id, selectedEnvId)
      message.success(t('components.runCollection.runStarted'))
      setOpen(false)
      navigate(`/runs/batches/${batchId}`)
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        message.error(axiosErr.response?.data?.error ?? t('components.runCollection.failedRunCollection'))
      } else {
        message.error(t('components.runCollection.failedRunCollection'))
      }
    } finally {
      setRunning(false)
    }
  }, [target, selectedEnvId, running, navigate, t])

  const modal = (
    <Modal
      title={t('components.runCollection.title')}
      open={open}
      onOk={confirm}
      onCancel={close}
      okText={t('components.runCollection.run')}
      confirmLoading={running}
      okButtonProps={{
        icon: <PlayCircleOutlined />,
        disabled: !target || target.suiteCount === 0,
      }}
      destroyOnClose
      width={520}
    >
      {target && (
        <>
          <div className="form-hint" style={{ marginTop: 0 }}>
            {t('components.runCollection.runHint', { count: target.suiteCount, name: target.name })}
          </div>
          <Form layout="vertical" requiredMark="optional" style={{ marginTop: 14 }}>
            <Form.Item
              label={t('components.runCollection.environment')}
              extra={t('components.runCollection.environmentExtra')}
              style={{ marginBottom: 8 }}
            >
              <Select
                showSearch
                allowClear
                placeholder={t('components.runCollection.environmentPlaceholder')}
                value={selectedEnvId}
                onChange={(val) => setSelectedEnvId(val)}
                options={environments}
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
