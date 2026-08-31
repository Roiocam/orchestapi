-- Project → Collection → Suite hierarchy.
-- Existing suites are backfilled into a single Default Project / Default Collection.

CREATE TABLE orchestrator.orchestapi_projects (
    id          UUID PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    deleted_at  TIMESTAMP,
    created_at  TIMESTAMP NOT NULL DEFAULT now(),
    updated_at  TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX orchestapi_projects_name_unique_active
    ON orchestrator.orchestapi_projects (name)
    WHERE deleted_at IS NULL;

CREATE TABLE orchestrator.orchestapi_collections (
    id          UUID PRIMARY KEY,
    project_id  UUID NOT NULL REFERENCES orchestrator.orchestapi_projects(id),
    name        VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    deleted_at  TIMESTAMP,
    created_at  TIMESTAMP NOT NULL DEFAULT now(),
    updated_at  TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX orchestapi_collections_name_unique_active
    ON orchestrator.orchestapi_collections (project_id, name)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_orchestapi_collections_project
    ON orchestrator.orchestapi_collections (project_id)
    WHERE deleted_at IS NULL;

-- Deterministic IDs so app code can resolve defaults after migration.
INSERT INTO orchestrator.orchestapi_projects (id, name, description, created_at, updated_at)
VALUES (
    '00000000-0000-4000-8000-000000000001',
    'Default Project',
    'Auto-created to preserve existing suites',
    now(),
    now()
);

INSERT INTO orchestrator.orchestapi_collections (id, project_id, name, description, created_at, updated_at)
VALUES (
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'Default Collection',
    'Auto-created to preserve existing suites',
    now(),
    now()
);

ALTER TABLE orchestrator.orchestapi_test_suites
    ADD COLUMN collection_id UUID;

UPDATE orchestrator.orchestapi_test_suites
SET collection_id = '00000000-0000-4000-8000-000000000002'
WHERE collection_id IS NULL;

ALTER TABLE orchestrator.orchestapi_test_suites
    ALTER COLUMN collection_id SET NOT NULL;

ALTER TABLE orchestrator.orchestapi_test_suites
    ADD CONSTRAINT fk_orchestapi_test_suites_collection
    FOREIGN KEY (collection_id) REFERENCES orchestrator.orchestapi_collections(id);

CREATE INDEX idx_orchestapi_test_suites_collection
    ON orchestrator.orchestapi_test_suites (collection_id)
    WHERE deleted_at IS NULL;

-- Suite names are unique within a collection (not globally).
DROP INDEX IF EXISTS orchestrator.test_suites_name_unique_active;

CREATE UNIQUE INDEX orchestapi_test_suites_name_unique_active
    ON orchestrator.orchestapi_test_suites (collection_id, name)
    WHERE deleted_at IS NULL;
