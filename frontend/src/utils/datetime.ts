import i18n from '../i18n'

/**
 * Backend returns LocalDateTime without offset (e.g. 2026-08-31T13:20:48.386241).
 * In Docker/cloud the JVM is typically UTC, so treat naive ISO datetimes as UTC.
 * JS Date otherwise parses them as local time and skips the timezone conversion.
 */
export function parseApiDateTime(value: string): Date {
  const trimmed = value.trim()
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    return new Date(trimmed)
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T00:00:00Z`)
  }
  return new Date(`${trimmed}Z`)
}

export function getActiveDateTimeLocale(): string {
  if (i18n.language.startsWith('zh')) return 'zh-CN'
  return 'en-US'
}

export function formatDateTime(
  value: string | null | undefined,
  fallback = '\u2014',
  locale?: string,
): string {
  if (!value) return fallback
  const date = parseApiDateTime(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleString(locale ?? getActiveDateTimeLocale())
}

export function formatDate(
  value: string | null | undefined,
  fallback = '-',
  locale?: string,
): string {
  if (!value) return fallback
  const date = parseApiDateTime(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleDateString(locale ?? getActiveDateTimeLocale())
}

export function formatTime(
  value: string | null | undefined,
  fallback = '-',
  locale?: string,
): string {
  if (!value) return fallback
  const date = parseApiDateTime(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleTimeString(locale ?? getActiveDateTimeLocale())
}
