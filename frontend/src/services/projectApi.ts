import axios from 'axios'
import type {
  ApiCollection,
  CollectionRequest,
  Project,
  ProjectRequest,
} from '../types/project'

const PROJECTS_BASE = '/api/projects'
const COLLECTIONS_BASE = '/api/collections'

export const projectApi = {
  list: () => axios.get<Project[]>(PROJECTS_BASE).then((r) => r.data),

  get: (id: string) => axios.get<Project>(`${PROJECTS_BASE}/${id}`).then((r) => r.data),

  create: (data: ProjectRequest) =>
    axios.post<Project>(PROJECTS_BASE, data).then((r) => r.data),

  update: (id: string, data: ProjectRequest) =>
    axios.put<Project>(`${PROJECTS_BASE}/${id}`, data).then((r) => r.data),

  delete: (id: string) => axios.delete(`${PROJECTS_BASE}/${id}`),
}

export const collectionApi = {
  list: (projectId?: string) =>
    axios
      .get<ApiCollection[]>(COLLECTIONS_BASE, {
        params: projectId ? { projectId } : undefined,
      })
      .then((r) => r.data),

  get: (id: string) =>
    axios.get<ApiCollection>(`${COLLECTIONS_BASE}/${id}`).then((r) => r.data),

  create: (data: CollectionRequest) =>
    axios.post<ApiCollection>(COLLECTIONS_BASE, data).then((r) => r.data),

  update: (id: string, data: CollectionRequest) =>
    axios.put<ApiCollection>(`${COLLECTIONS_BASE}/${id}`, data).then((r) => r.data),

  delete: (id: string) => axios.delete(`${COLLECTIONS_BASE}/${id}`),
}
