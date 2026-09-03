package com.orchestrator.dto;

import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.*;

import java.util.ArrayList;
import java.util.List;

/**
 * Portable environment package format (formatVersion 1).
 * Exported as standalone JSON when there are no files, or as {@code manifest.json}
 * inside a zip when files are present.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EnvironmentManifest {

    public static final int CURRENT_FORMAT_VERSION = 1;

    @Builder.Default
    private int formatVersion = CURRENT_FORMAT_VERSION;

    @NotBlank(message = "Name is required")
    @Size(max = 100, message = "Name must not exceed 100 characters")
    private String name;

    @NotBlank(message = "Base URL is required")
    @Size(max = 500, message = "Base URL must not exceed 500 characters")
    @Pattern(regexp = "^https?://.*", message = "Base URL must start with http:// or https://")
    private String baseUrl;

    @Valid
    @JsonSetter(nulls = Nulls.AS_EMPTY)
    @Builder.Default
    private List<VariableDto> variables = new ArrayList<>();

    @Valid
    @JsonSetter(nulls = Nulls.AS_EMPTY)
    @Builder.Default
    private List<HeaderDto> headers = new ArrayList<>();

    @Valid
    @JsonSetter(nulls = Nulls.AS_EMPTY)
    @Builder.Default
    private List<ConnectorDto> connectors = new ArrayList<>();

    @Valid
    private EnvironmentOAuthRequest oauth;

    @Valid
    @JsonSetter(nulls = Nulls.AS_EMPTY)
    @Builder.Default
    private List<FileEntry> files = new ArrayList<>();

    @Getter
    @Setter
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class FileEntry {
        @NotBlank
        private String fileKey;

        @NotBlank
        private String fileName;

        private String contentType;

        /** Relative path inside the zip package, e.g. {@code files/cert/client.pem}. */
        private String path;
    }
}
