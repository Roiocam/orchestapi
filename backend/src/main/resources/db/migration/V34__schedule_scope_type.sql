-- Scope-aware schedules: SUITE | COLLECTION | PROJECT
ALTER TABLE orchestrator.orchestapi_run_schedules
    ADD COLUMN scope_type VARCHAR(20),
    ADD COLUMN scope_id UUID;

UPDATE orchestrator.orchestapi_run_schedules
SET scope_type = 'SUITE',
    scope_id = suite_id
WHERE scope_type IS NULL;

ALTER TABLE orchestrator.orchestapi_run_schedules
    ALTER COLUMN scope_type SET NOT NULL,
    ALTER COLUMN scope_id SET NOT NULL;

ALTER TABLE orchestrator.orchestapi_run_schedules
    ALTER COLUMN suite_id DROP NOT NULL;

CREATE INDEX idx_orchestapi_run_schedules_scope
    ON orchestrator.orchestapi_run_schedules (scope_type, scope_id);
