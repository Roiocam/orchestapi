package com.orchestrator.dto;

import lombok.*;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Outbound payload for the external notification event engine.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ExternalNotifyEvent {
    private String eventId;
    private String businessId;
    private String eventName;
    private long timestamp;
    private String operator;
    @Builder.Default
    private Map<String, Object> label = new LinkedHashMap<>();
}
