package com.orchestrator.dto;

import lombok.*;

import java.util.ArrayList;
import java.util.List;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EnvironmentImportResponse {

    private EnvironmentResponse environment;

    @Builder.Default
    private List<String> warnings = new ArrayList<>();
}
