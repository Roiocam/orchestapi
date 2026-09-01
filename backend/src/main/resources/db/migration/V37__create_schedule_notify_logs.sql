CREATE TABLE orchestrator.orchestapi_schedule_notify_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id UUID REFERENCES orchestrator.orchestapi_run_schedules(id),
    event_id VARCHAR(64),
    event_name VARCHAR(200),
    business_id VARCHAR(200),
    notify_url VARCHAR(2000) NOT NULL,
    success BOOLEAN NOT NULL DEFAULT false,
    http_status INTEGER,
    request_body TEXT,
    response_body TEXT,
    error_message TEXT,
    duration_ms BIGINT NOT NULL DEFAULT 0,
    batch_id UUID,
    run_status VARCHAR(30),
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_orchestapi_schedule_notify_logs_created_at
    ON orchestrator.orchestapi_schedule_notify_logs (created_at DESC);

CREATE INDEX idx_orchestapi_schedule_notify_logs_schedule_id
    ON orchestrator.orchestapi_schedule_notify_logs (schedule_id);

CREATE INDEX idx_orchestapi_schedule_notify_logs_success
    ON orchestrator.orchestapi_schedule_notify_logs (success);
