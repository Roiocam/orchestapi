import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ConfigProvider, Result, Button, App as AntApp } from 'antd'
import { useAntdLocale } from './hooks/useAntdLocale'
import AppLayout from './components/AppLayout'
import { ProjectProvider } from './context/ProjectContext'
import EnvironmentsPage from './pages/EnvironmentsPage'
import EnvironmentDetailPage from './pages/EnvironmentDetailPage'
import TestSuitesPage from './pages/TestSuitesPage'
import TestSuiteDetailPage from './pages/TestSuiteDetailPage'
import RunsPage from './pages/RunsPage'
import BatchDetailPage from './pages/BatchDetailPage'
import MockServerPage from './pages/MockServerPage'
import WebhookPage from './pages/WebhookPage'
import ProjectsPage from './pages/ProjectsPage'

function NotFoundPage() {
  const { t } = useTranslation()
  const base = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'
  return (
    <Result
      status="404"
      title={t('pages.notFound.title')}
      extra={
        <Button type="primary" href={base}>
          {t('pages.notFound.goToTestSuites')}
        </Button>
      }
    />
  )
}

function App() {
  const antdLocale = useAntdLocale()

  return (
    <ConfigProvider
      locale={antdLocale}
      componentSize="middle"
      theme={{
        token: {
          colorPrimary: '#0e7490',
          colorInfo: '#0e7490',
          colorSuccess: '#16a34a',
          colorWarning: '#d97706',
          colorError: '#dc2626',
          colorBgLayout: '#f3f6fa',
          colorBgContainer: '#ffffff',
          colorBorder: '#e2e8f0',
          colorBorderSecondary: '#eef2f7',
          colorText: '#0f172a',
          colorTextSecondary: '#475569',
          colorTextTertiary: '#64748b',
          borderRadius: 8,
          borderRadiusLG: 12,
          borderRadiusSM: 6,
          controlHeight: 34,
          controlHeightSM: 28,
          fontSize: 13,
          fontFamily: "'Outfit', sans-serif",
          fontFamilyCode: "'Fira Code', monospace",
          boxShadowSecondary: '0 8px 24px rgba(15, 23, 42, 0.08)',
          motionDurationMid: '0.16s',
        },
        components: {
          Button: {
            fontWeight: 560,
            controlHeight: 34,
            paddingInline: 14,
          },
          Input: {
            paddingBlock: 6,
            paddingInline: 11,
          },
          Select: {
            controlHeight: 34,
          },
          Form: {
            labelColor: '#334155',
            labelFontSize: 12,
            verticalLabelPadding: '0 0 4px',
            itemMarginBottom: 14,
          },
          Card: {
            paddingLG: 18,
            headerFontSize: 14,
          },
          Modal: {
            borderRadiusLG: 12,
            paddingContentHorizontalLG: 20,
          },
          Table: {
            headerBg: '#f8fafc',
            headerColor: '#64748b',
            rowHoverBg: '#f0f9fb',
            headerSplitColor: 'transparent',
          },
          Tabs: {
            titleFontSize: 13,
            horizontalItemGutter: 20,
          },
          Tree: {
            directoryNodeSelectedBg: 'rgba(14, 116, 144, 0.12)',
            nodeHoverBg: 'rgba(14, 116, 144, 0.08)',
          },
        },
      }}
    >
      <AntApp>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
          <ProjectProvider>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="/" element={<TestSuitesPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/environments" element={<EnvironmentsPage />} />
                <Route path="/environments/:id" element={<EnvironmentDetailPage />} />
                <Route path="/test-suites" element={<TestSuitesPage />} />
                <Route path="/test-suites/:id" element={<TestSuiteDetailPage />} />
                <Route path="/runs" element={<RunsPage />} />
                <Route path="/runs/batches/:id" element={<BatchDetailPage />} />
                <Route path="/mock-server" element={<MockServerPage />} />
                <Route path="/mock-server/:serverId" element={<MockServerPage />} />
                <Route path="/webhooks" element={<WebhookPage />} />
                <Route path="/webhooks/:id" element={<WebhookPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </ProjectProvider>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  )
}

export default App
