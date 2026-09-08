package com.orchestrator.model;

import com.fasterxml.jackson.core.JsonPointer;

/** Opt-in cursor paging contract for GET steps; paths are JSON Pointers, not JSONPath expressions. */
public record CursorPaginationConfig(
        String cursorParam, String nextCursorPath, String itemsPath, Integer maxPages) {

    public CursorPaginationConfig {
        if (cursorParam == null || !cursorParam.matches("[A-Za-z_][A-Za-z0-9_.-]*")) {
            throw new IllegalArgumentException("cursorPagination.cursorParam must be a query parameter name");
        }
        validatePointer(nextCursorPath, "nextCursorPath");
        validatePointer(itemsPath, "itemsPath");
        if (nextCursorPath.equals(itemsPath) || nextCursorPath.startsWith(itemsPath + "/")
                || itemsPath.startsWith(nextCursorPath + "/")) {
            throw new IllegalArgumentException("cursorPagination paths must not overlap");
        }
        maxPages = maxPages == null ? 100 : maxPages;
        if (maxPages < 1 || maxPages > 1000) {
            throw new IllegalArgumentException("cursorPagination.maxPages must be between 1 and 1000");
        }
    }

    private static void validatePointer(String path, String name) {
        if (path == null || !path.startsWith("/")) {
            throw new IllegalArgumentException("cursorPagination." + name + " must be a non-root JSON Pointer");
        }
        JsonPointer.compile(path);
    }
}
