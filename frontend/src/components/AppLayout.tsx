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
import SuiteExplorer from './SuiteExplorer'

const { Sider, Content, Header } = Layout

const navItems = [
  { key: '/', icon: <ExperimentOutlined />, label: 'Suites' },
  { key: '/projects', icon: <ProjectOutlined />, label: 'Projects' },
  { key: '/environments', icon: <SettingOutlined />, label: 'Envs' },
  { key: '/runs', icon: <PlayCircleOutlined />, label: 'Runs' },
  { key: '/mock-server', icon: <CloudServerOutlined />, label: 'Mock' },
  { key: '/webhooks', icon: <NodeIndexOutlined />, label: 'Webhooks' },
]

const pageLabelMap: Record<string, string> = {
  '/': 'Suites',
  '/test-suites': 'Suites',
  '/projects': 'Projects',
  '/environments': 'Environments',
  '/runs': 'Runs',
  '/mock-server': 'Mock Server',
  '/webhooks': 'Webhooks',
}

function isSuiteWorkspace(pathname: string) {
  return pathname === '/' || pathname.startsWith('/test-suites')
}

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { token } = theme.useToken()

  const matchedKey = Object.keys(pageLabelMap)
    .filter((k) => location.pathname.startsWith(k) && k !== '/')
    .sort((a, b) => b.length - a.length)[0] ?? '/'

  const selectedKey = matchedKey === '/test-suites' ? '/' : matchedKey
  const pageLabel = pageLabelMap[matchedKey] ?? 'Suites'
  const showExplorer = isSuiteWorkspace(location.pathname)

  return (
    <Layout className="app-shell">
      <a className="skip-to-content" href="#main-content">
        Skip to main content
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
          <img src="/icon.svg" alt="OrchestAPI" width={22} height={22} />
        </div>
        <nav className="app-icon-rail-nav" aria-label="Primary">
          {navItems.map((item) => {
            const isActive = item.key === selectedKey
            return (
              <button
                key={item.key}
                type="button"
                className={`app-icon-rail-item${isActive ? ' is-active' : ''}`}
                aria-label={pageLabelMap[item.key] || item.label}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => navigate(item.key)}
              >
                <span className="app-icon-rail-icon">{item.icon}</span>
                <span className="app-icon-rail-label">{item.label}</span>
              </button>
            )
          })}
        </nav>
      </Sider>

      {/* Explorer panel — collections as folders */}
      {showExplorer && (
        <aside className="app-explorer" aria-label="Suite explorer">
          <SuiteExplorer />
        </aside>
      )}

      <Layout className="app-workbench">
        <Header
          className="app-workbench-header"
          style={{ borderBottomColor: token.colorBorderSecondary }}
        >
          <div className="app-workbench-title">{pageLabel}</div>
          {!showExplorer && (
            <div className="app-workbench-meta">OrchestAPI</div>
          )}
        </Header>
        <Content id="main-content" className="app-workbench-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
