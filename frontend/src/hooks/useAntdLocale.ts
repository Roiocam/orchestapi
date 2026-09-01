import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import type { Locale } from 'antd/es/locale'

export function useAntdLocale(): Locale {
  const { i18n } = useTranslation()

  return useMemo(() => {
    if (i18n.language.startsWith('zh')) return zhCN
    return enUS
  }, [i18n.language])
}

export function getDateTimeLocale(language: string): string {
  if (language.startsWith('zh')) return 'zh-CN'
  return 'en-US'
}
