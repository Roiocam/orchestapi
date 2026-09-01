import { Layout, theme } from 'antd'
import {
  ExperimentOutlined,
  SettingOutlined,
  PlayCircleOutlined,
  CloudServerOutlined,
  NodeIndexOutlined,
  ProjectOutlined,
} from '@ant-design/icons'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import SuiteExplorer from './SuiteExplorer'
import LanguageSwitcher from './LanguageSwitcher'

const { Sider, Content, Header } = Layout

const navItems = [
  { key: '/', icon: <ExperimentOutlined />, labelKey: 'nav.suites' },
  { key: '/projects', icon: <ProjectOutlined />, labelKey: 'nav.projects' },
  { key: '/environments', icon: <SettingOutlined />, labelKey: 'nav.envs' },
  { key: '/runs', icon: <PlayCircleOutlined />, labelKey: 'nav.runs' },
  { key: '/mock-server', icon: <CloudServerOutlined />, labelKey: 'nav.mock' },
  { key: '/webhooks', icon: <NodeIndexOutlined />, labelKey: 'nav.webhooks' },
]

const pageLabelKeys: Record<string, string> = {
  '/': 'nav.suites',
  '/test-suites': 'nav.suites',
  '/projects': 'nav.projects',
  '/environments': 'nav.environments',
  '/runs': 'nav.runs',
  '/mock-server': 'nav.mockServer',
  '/webhooks': 'nav.webhooks',
}

function isSuiteWorkspace(pathname: string) {
  return pathname === '/' || pathname.startsWith('/test-suites')
}

export default function AppLayout() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { token } = theme.useToken()

  const matchedKey = Object.keys(pageLabelKeys)
    .filter((k) => location.pathname.startsWith(k) && k !== '/')
    .sort((a, b) => b.length - a.length)[0] ?? '/'

  const selectedKey = matchedKey === '/test-suites' ? '/' : matchedKey
  const pageLabel = t(pageLabelKeys[matchedKey] ?? 'nav.suites')
  const showExplorer = isSuiteWorkspace(location.pathname)

  return (
    <Layout className="app-shell">
      <a className="skip-to-content" href="#main-content">
        {t('common.skipToContent')}
      </a>

      {/* Icon rail — Postman/Bruno style primary nav */}
      <Sider
        collapsed
        collapsedWidth={64}
        className="app-icon-rail"
        theme="light"
        trigger={null}
      >
        <div className="app-icon-rail-logo">
          <img src="/icon.svg" alt={t('common.appName')} width={22} height={22} />
        </div>
        <nav className="app-icon-rail-nav" aria-label={t('common.primaryNav')}>
          {navItems.map((item) => {
            const isActive = item.key === selectedKey
            const itemPageLabel = t(pageLabelKeys[item.key] ?? item.labelKey)
            const itemNavLabel = t(item.labelKey)
            return (
              <button
                key={item.key}
                type="button"
                className={`app-icon-rail-item${isActive ? ' is-active' : ''}`}
                aria-label={itemPageLabel}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => navigate(item.key)}
              >
                <span className="app-icon-rail-icon">{item.icon}</span>
                <span className="app-icon-rail-label">{itemNavLabel}</span>
              </button>
            )
          })}
        </nav>
      </Sider>

      {/* Explorer panel — collections as folders */}
      {showExplorer && (
        <aside className="app-explorer" aria-label={t('common.suiteExplorer')}>
          <SuiteExplorer />
        </aside>
      )}

      <Layout className="app-workbench">
        <Header
          className="app-workbench-header"
          style={{ borderBottomColor: token.colorBorderSecondary }}
        >
          <div className="app-workbench-title">{pageLabel}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {!showExplorer && (
              <div className="app-workbench-meta">{t('common.appName')}</div>
            )}
            <LanguageSwitcher />
          </div>
        </Header>
        <Content id="main-content" className="app-workbench-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
