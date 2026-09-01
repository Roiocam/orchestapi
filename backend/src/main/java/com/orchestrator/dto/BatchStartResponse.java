package com.orchestrator.dto;

import lombok.*;

import java.util.UUID;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class BatchStartResponse {
    private UUID batchId;
}
