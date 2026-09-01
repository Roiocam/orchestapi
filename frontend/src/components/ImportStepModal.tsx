import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Input, Button, Alert, Space } from 'antd'
import { ImportOutlined } from '@ant-design/icons'
import { testStepApi } from '../services/testSuiteApi'

interface ImportStepModalProps {
  open: boolean
  suiteId: string
  onSuccess: () => void
  onCancel: () => void
}

export default function ImportStepModal({ open, suiteId, onSuccess, onCancel }: ImportStepModalProps) {
  const { t } = useTranslation()
  const [curlValue, setCurlValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleImport = async () => {
    setError(null)
    if (!curlValue.trim()) {
      setError(t('components.importStep.enterCurl'))
      return
    }
    setLoading(true)
    try {
      await testStepApi.importCurl(suiteId, curlValue.trim())
      setCurlValue('')
      setError(null)
      onSuccess()
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string; message?: string } } }
        setError(axiosErr.response?.data?.error ?? axiosErr.response?.data?.message ?? t('common.importFailed'))
      } else {
        setError(t('common.importFailed'))
      }
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    setCurlValue('')
    setError(null)
    onCancel()
  }

  return (
    <Modal
      title={t('components.importStep.title')}
      open={open}
      onCancel={handleCancel}
      width={640}
      footer={
        <Space>
          <Button onClick={handleCancel}>{t('common.cancel')}</Button>
          <Button
            type="primary"
            icon={<ImportOutlined />}
            onClick={handleImport}
            loading={loading}
          >
            {t('common.import')}
          </Button>
        </Space>
      }
    >
      <div>
        <p className="form-hint" style={{ marginTop: 0 }}>
          {t('components.importStep.hint')}
        </p>
        <Input.TextArea
          rows={10}
          value={curlValue}
          onChange={(e) => setCurlValue(e.target.value)}
          placeholder={t('components.importStep.curlPlaceholder')}
          style={{ fontFamily: 'var(--font-code)', fontSize: 13 }}
          autoFocus
        />
      </div>

      {error && (
        <Alert
          type="error"
          message={error}
          showIcon
          closable
          onClose={() => setError(null)}
          style={{ marginTop: 12 }}
        />
      )}
    </Modal>
  )
}
