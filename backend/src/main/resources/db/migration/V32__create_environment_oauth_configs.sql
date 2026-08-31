CREATE TABLE orchestrator.orchestapi_environment_oauth_configs (
    environment_id UUID PRIMARY KEY
        REFERENCES orchestrator.orchestapi_environments(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT false,
    token_endpoint VARCHAR(1000) NOT NULL DEFAULT '',
    client_id VARCHAR(255) NOT NULL DEFAULT '',
    client_secret TEXT NOT NULL DEFAULT '',
    scopes TEXT NOT NULL DEFAULT '',
    audience TEXT NOT NULL DEFAULT '',
    client_auth_method VARCHAR(32) NOT NULL DEFAULT 'client_secret_basic',
    refresh_skew_seconds BIGINT NOT NULL DEFAULT 60,
    request_timeout_ms BIGINT NOT NULL DEFAULT 10000,
    revision BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT orchestapi_environment_oauth_configs_auth_method_check
        CHECK (client_auth_method IN ('client_secret_basic', 'client_secret_post')),
    CONSTRAINT orchestapi_environment_oauth_configs_refresh_skew_check
        CHECK (refresh_skew_seconds >= 0),
    CONSTRAINT orchestapi_environment_oauth_configs_timeout_check
        CHECK (request_timeout_ms > 0),
    CONSTRAINT orchestapi_environment_oauth_configs_revision_check
        CHECK (revision > 0)
);

INSERT INTO orchestrator.orchestapi_environment_oauth_configs (environment_id)
SELECT id
FROM orchestrator.orchestapi_environments
ON CONFLICT (environment_id) DO NOTHING;
