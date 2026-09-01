import { Select } from 'antd'
import { GlobalOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES, type AppLanguage } from '../i18n'

const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  en: 'English',
  'zh-CN': '中文',
}

export default function LanguageSwitcher() {
  const { i18n } = useTranslation()

  const current = SUPPORTED_LANGUAGES.includes(i18n.language as AppLanguage)
    ? (i18n.language as AppLanguage)
    : 'en'

  return (
    <Select
      size="small"
      variant="borderless"
      className="language-switcher"
      value={current}
      suffixIcon={<GlobalOutlined style={{ fontSize: 12 }} />}
      popupMatchSelectWidth={false}
      options={SUPPORTED_LANGUAGES.map((lang) => ({
        value: lang,
        label: LANGUAGE_LABELS[lang],
      }))}
      onChange={(lang: AppLanguage) => {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, lang)
        void i18n.changeLanguage(lang)
      }}
      aria-label="Language"
    />
  )
}
