package com.orchestrator.model;

import java.util.UUID;

/**
 * Seeded by V32 migration for backward-compatible Project → Collection → Suite hierarchy.
 */
public final class DefaultHierarchyIds {

    public static final UUID DEFAULT_PROJECT_ID =
            UUID.fromString("00000000-0000-4000-8000-000000000001");

    public static final UUID DEFAULT_COLLECTION_ID =
            UUID.fromString("00000000-0000-4000-8000-000000000002");

    private DefaultHierarchyIds() {
    }
}
