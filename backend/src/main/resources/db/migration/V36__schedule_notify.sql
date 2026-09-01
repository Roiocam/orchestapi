-- Outbound notification to external event engine (HTTP POST envelope + label)
ALTER TABLE orchestrator.orchestapi_run_schedules
    ADD COLUMN notify_enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN notify_url VARCHAR(2000),
    ADD COLUMN notify_on VARCHAR(20) NOT NULL DEFAULT 'ON_FAILURE',
    ADD COLUMN notify_event_name VARCHAR(200),
    ADD COLUMN notify_business_id VARCHAR(200),
    ADD COLUMN notify_operator VARCHAR(100),
    ADD COLUMN notify_extra_labels jsonb NOT NULL DEFAULT '{}'::jsonb;
