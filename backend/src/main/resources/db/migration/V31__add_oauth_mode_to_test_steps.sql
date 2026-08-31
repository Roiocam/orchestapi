ALTER TABLE orchestrator.orchestapi_test_steps
    ADD COLUMN oauth_mode VARCHAR(16) NOT NULL DEFAULT 'INHERIT';

ALTER TABLE orchestrator.orchestapi_test_steps
    ADD CONSTRAINT orchestapi_test_steps_oauth_mode_check
    CHECK (oauth_mode IN ('INHERIT', 'DISABLED'));
