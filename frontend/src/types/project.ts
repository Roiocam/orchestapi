export const DEFAULT_PROJECT_ID = '00000000-0000-4000-8000-000000000001'
export const DEFAULT_COLLECTION_ID = '00000000-0000-4000-8000-000000000002'

export interface Project {
  id: string
  name: string
  description: string
  isDefault: boolean
  collectionCount: number
  createdAt: string
  updatedAt: string
}

export interface ProjectRequest {
  name: string
  description: string
}

export interface ApiCollection {
  id: string
  projectId: string
  name: string
  description: string
  isDefault: boolean
  suiteCount: number
  createdAt: string
  updatedAt: string
}

export interface CollectionRequest {
  projectId: string
  name: string
  description: string
}
