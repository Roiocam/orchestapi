export type HeaderValueType = 'STATIC' | 'VARIABLE' | 'UUID' | 'ISO_TIMESTAMP'

export type VariableValueType = 'STATIC' | 'UUID' | 'ISO_TIMESTAMP'

export type OAuthClientAuthMethod = 'client_secret_basic' | 'client_secret_post'

export interface VariableDto {
  id?: string
  key: string
  value: string
  valueType?: VariableValueType
  secret: boolean
}

export interface HeaderDto {
  id?: string
  headerKey: string
  valueType: HeaderValueType
  headerValue: string
}

export type ConnectorType =
  | 'MYSQL' | 'POSTGRES' | 'ORACLE' | 'SQLSERVER'
  | 'REDIS' | 'ELASTICSEARCH' | 'KAFKA' | 'RABBITMQ' | 'MONGODB'

export interface ConnectorDto {
  id?: string
  name: string
  type: ConnectorType
  config: Record<string, string>
}

export interface EnvironmentOAuthResponse {
  enabled: boolean
  tokenEndpoint: string
  clientId: string
  /** Always masked by the API when a secret has been configured. */
  clientSecret: string
  clientSecretConfigured: boolean
  scopes: string
  audience: string
  clientAuthMethod: OAuthClientAuthMethod
  refreshSkewSeconds: number
  requestTimeoutMs: number
}

export interface EnvironmentOAuthRequest {
  enabled: boolean
  tokenEndpoint: string
  clientId: string
  /** Omit this field to preserve an existing secret. */
  clientSecret?: string
  scopes: string
  audience: string
  clientAuthMethod: OAuthClientAuthMethod
  refreshSkewSeconds: number
  requestTimeoutMs: number
  clearClientSecret?: boolean
}

export interface Environment {
  id: string
  name: string
  baseUrl: string
  variables: VariableDto[]
  headers: HeaderDto[]
  connectors: ConnectorDto[]
  oauth: EnvironmentOAuthResponse
  createdAt: string
  updatedAt: string
}

export interface EnvironmentRequest {
  name: string
  baseUrl: string
  variables: VariableDto[]
  headers: HeaderDto[]
  connectors: ConnectorDto[]
  oauth?: EnvironmentOAuthRequest
}

export interface EnvironmentFileResponse {
  id: string
  fileKey: string
  fileName: string
  contentType: string
  fileSize: number
  createdAt: string
}

export interface PageResponse<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}
