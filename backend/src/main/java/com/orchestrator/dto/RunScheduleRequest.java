package com.orchestrator.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.*;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class RunScheduleRequest {

    /**
     * SUITE | COLLECTION | PROJECT. Defaults to SUITE when omitted and {@link #suiteId} is set.
     */
    @Size(max = 20)
    private String scopeType;

    /** Target id for the given scope. Required unless legacy {@link #suiteId} is used. */
    private UUID scopeId;

    /**
     * Legacy field: treated as scopeType=SUITE + scopeId=suiteId when scopeType/scopeId omitted.
     */
    private UUID suiteId;

    @NotNull(message = "Environment ID is required")
    private UUID environmentId;

    @NotBlank(message = "Cron expression is required")
    @Size(max = 100)
    private String cronExpression;

    @Size(max = 255)
    private String description;

    private Boolean notifyEnabled;

    @Size(max = 2000)
    private String notifyUrl;

    /** ALWAYS | ON_FAILURE. Defaults to ON_FAILURE. */
    @Size(max = 20)
    private String notifyOn;

    @Size(max = 200)
    private String notifyEventName;

    @Size(max = 200)
    private String notifyBusinessId;

    @Size(max = 100)
    private String notifyOperator;

    /** Extra labels merged into the outbound event label map. */
    private Map<String, String> notifyExtraLabels = new LinkedHashMap<>();
}
