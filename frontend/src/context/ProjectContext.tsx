import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { message } from 'antd'
import { collectionApi, projectApi } from '../services/projectApi'
import type { ApiCollection, Project } from '../types/project'
import { DEFAULT_COLLECTION_ID, DEFAULT_PROJECT_ID } from '../types/project'

const PROJECT_STORAGE_KEY = 'orchestapi.selectedProjectId'
const COLLECTION_STORAGE_KEY = 'orchestapi.selectedCollectionId'
const ALL_COLLECTIONS = '__all__'

interface ProjectContextValue {
  projects: Project[]
  collections: ApiCollection[]
  projectId: string | null
  /** null = all collections in the current project */
  collectionId: string | null
  loading: boolean
  setProjectId: (id: string) => void
  setCollectionId: (id: string | null) => void
  /** Collection to use when creating/importing a suite */
  effectiveCollectionId: string | null
  refreshProjects: () => Promise<void>
  refreshCollections: () => Promise<void>
  /** Bump to reload the suite explorer tree */
  suiteTreeVersion: number
  bumpSuiteTree: () => void
}

const ProjectContext = createContext<ProjectContextValue | null>(null)

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [collections, setCollections] = useState<ApiCollection[]>([])
  const [projectId, setProjectIdState] = useState<string | null>(
    () => localStorage.getItem(PROJECT_STORAGE_KEY),
  )
  const [collectionId, setCollectionIdState] = useState<string | null>(() => {
    const stored = localStorage.getItem(COLLECTION_STORAGE_KEY)
    if (!stored || stored === ALL_COLLECTIONS) return null
    return stored
  })
  const [loading, setLoading] = useState(true)
  const [suiteTreeVersion, setSuiteTreeVersion] = useState(0)

  const bumpSuiteTree = useCallback(() => {
    setSuiteTreeVersion((v) => v + 1)
  }, [])

  const refreshProjects = useCallback(async () => {
    const list = await projectApi.list()
    setProjects(list)
    setProjectIdState((current) => {
      const stored = current ?? localStorage.getItem(PROJECT_STORAGE_KEY)
      const next =
        (stored && list.some((p) => p.id === stored) && stored) ||
        list.find((p) => p.id === DEFAULT_PROJECT_ID)?.id ||
        list[0]?.id ||
        null
      if (next) localStorage.setItem(PROJECT_STORAGE_KEY, next)
      else localStorage.removeItem(PROJECT_STORAGE_KEY)
      return next
    })
  }, [])

  const refreshCollections = useCallback(async () => {
    if (!projectId) {
      setCollections([])
      setCollectionIdState(null)
      localStorage.setItem(COLLECTION_STORAGE_KEY, ALL_COLLECTIONS)
      return
    }
    const list = await collectionApi.list(projectId)
    setCollections(list)
    setCollectionIdState((current) => {
      const stored = localStorage.getItem(COLLECTION_STORAGE_KEY)
      if (stored === ALL_COLLECTIONS || (current === null && stored === null)) {
        localStorage.setItem(COLLECTION_STORAGE_KEY, ALL_COLLECTIONS)
        return null
      }
      const candidate = current ?? (stored && stored !== ALL_COLLECTIONS ? stored : null)
      if (candidate && list.some((c) => c.id === candidate)) {
        localStorage.setItem(COLLECTION_STORAGE_KEY, candidate)
        return candidate
      }
      // Prefer default collection within this project, else first, else All
      const fallback =
        list.find((c) => c.id === DEFAULT_COLLECTION_ID)?.id || list[0]?.id || null
      if (fallback) localStorage.setItem(COLLECTION_STORAGE_KEY, fallback)
      else localStorage.setItem(COLLECTION_STORAGE_KEY, ALL_COLLECTIONS)
      return fallback
    })
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        await refreshProjects()
      } catch {
        if (!cancelled) message.error('Failed to load projects')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshProjects])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await refreshCollections()
      } catch {
        if (!cancelled) message.error('Failed to load collections')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshCollections])

  const setProjectId = useCallback((id: string) => {
    localStorage.setItem(PROJECT_STORAGE_KEY, id)
    localStorage.setItem(COLLECTION_STORAGE_KEY, ALL_COLLECTIONS)
    setCollectionIdState(null)
    setProjectIdState(id)
  }, [])

  const setCollectionId = useCallback((id: string | null) => {
    if (id) localStorage.setItem(COLLECTION_STORAGE_KEY, id)
    else localStorage.setItem(COLLECTION_STORAGE_KEY, ALL_COLLECTIONS)
    setCollectionIdState(id)
  }, [])

  const effectiveCollectionId = useMemo(() => {
    if (collectionId) return collectionId
    return (
      collections.find((c) => c.id === DEFAULT_COLLECTION_ID)?.id ||
      collections[0]?.id ||
      null
    )
  }, [collectionId, collections])

  const value = useMemo(
    () => ({
      projects,
      collections,
      projectId,
      collectionId,
      loading,
      setProjectId,
      setCollectionId,
      effectiveCollectionId,
      refreshProjects,
      refreshCollections,
      suiteTreeVersion,
      bumpSuiteTree,
    }),
    [
      projects,
      collections,
      projectId,
      collectionId,
      loading,
      setProjectId,
      setCollectionId,
      effectiveCollectionId,
      refreshProjects,
      refreshCollections,
      suiteTreeVersion,
      bumpSuiteTree,
    ],
  )

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}

export function useProjectContext() {
  const ctx = useContext(ProjectContext)
  if (!ctx) throw new Error('useProjectContext must be used within ProjectProvider')
  return ctx
}
