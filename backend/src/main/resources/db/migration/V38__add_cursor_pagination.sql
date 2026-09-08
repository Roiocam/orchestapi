-- Opt-in request paging; existing steps retain their original retry semantics.
ALTER TABLE orchestrator.orchestapi_test_steps
    ADD COLUMN cursor_pagination jsonb;
