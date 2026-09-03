package com.orchestrator.dto;

import lombok.Builder;

@Builder
public record EnvironmentExportResult(
        byte[] content,
        String contentType,
        String filename
) {}
