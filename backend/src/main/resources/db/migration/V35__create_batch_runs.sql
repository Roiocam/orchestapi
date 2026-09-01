CREATE TABLE orchestrator.orchestapi_batch_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type VARCHAR(20) NOT NULL,
    scope_id UUID NOT NULL,
    scope_name VARCHAR(200),
    environment_id UUID,
    schedule_id UUID,
    trigger_type VARCHAR(20) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'RUNNING',
    total_suites INT NOT NULL DEFAULT 0,
    succeeded INT NOT NULL DEFAULT 0,
    failed INT NOT NULL DEFAULT 0,
    started_at TIMESTAMP NOT NULL DEFAULT now(),
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP
);

CREATE INDEX idx_orchestapi_batch_runs_status ON orchestrator.orchestapi_batch_runs (status);
CREATE INDEX idx_orchestapi_batch_runs_trigger_type ON orchestrator.orchestapi_batch_runs (trigger_type);
CREATE INDEX idx_orchestapi_batch_runs_started_at ON orchestrator.orchestapi_batch_runs (started_at);
CREATE INDEX idx_orchestapi_batch_runs_scope ON orchestrator.orchestapi_batch_runs (scope_type, scope_id);

ALTER TABLE orchestrator.orchestapi_test_runs
    ADD COLUMN batch_id UUID;

CREATE INDEX idx_orchestapi_test_runs_batch_id ON orchestrator.orchestapi_test_runs (batch_id);
