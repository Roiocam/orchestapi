package com.orchestrator.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.orchestrator.dto.ExternalNotifyEvent;
import com.orchestrator.dto.SuiteBatchRunResult;
import com.orchestrator.model.RunSchedule;
import com.orchestrator.model.enums.ScheduleNotifyOn;
import com.orchestrator.model.enums.ScheduleScopeType;
import com.orchestrator.repository.ScheduleNotifyLogRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ScheduleNotifyServiceTest {

    ScheduleNotifyService service;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = mock(RestClient.Builder.class);
        when(builder.build()).thenReturn(mock(RestClient.class));
        service = new ScheduleNotifyService(
                builder,
                "https://example.com/orchestapi",
                mock(ScheduleNotifyLogRepository.class),
                new ObjectMapper());
    }

    @Test
    void resolveOverallStatusHandlesEmptyAndMixed() {
        assertEquals("SUCCESS", ScheduleNotifyService.resolveOverallStatus(List.of()));
        assertEquals("SUCCESS", ScheduleNotifyService.resolveOverallStatus(List.of(
                SuiteBatchRunResult.builder().status("SUCCESS").build())));
        assertEquals("FAILURE", ScheduleNotifyService.resolveOverallStatus(List.of(
                SuiteBatchRunResult.builder().status("FAILURE").build())));
        assertEquals("PARTIAL_FAILURE", ScheduleNotifyService.resolveOverallStatus(List.of(
                SuiteBatchRunResult.builder().status("SUCCESS").build(),
                SuiteBatchRunResult.builder().status("FAILURE").build())));
    }

    @Test
    void buildEventUsesEnvelopeAndLabel() {
        UUID scheduleId = UUID.randomUUID();
        UUID scopeId = UUID.randomUUID();
        UUID envId = UUID.randomUUID();
        UUID batchId = UUID.randomUUID();
        Map<String, String> extra = new LinkedHashMap<>();
        extra.put("team", "platform");
        extra.put("status", "should-not-override");

        RunSchedule schedule = RunSchedule.builder()
                .id(scheduleId)
                .scopeType(ScheduleScopeType.COLLECTION)
                .scopeId(scopeId)
                .environmentId(envId)
                .cronExpression("0 0 2 * * *")
                .notifyEnabled(true)
                .notifyUrl("https://notify.example/events")
                .notifyOn(ScheduleNotifyOn.ALWAYS)
                .notifyEventName("custom.event")
                .notifyBusinessId("biz-1")
                .notifyOperator("ci")
                .notifyExtraLabels(extra)
                .build();

        ExternalNotifyEvent event = service.buildEvent(
                schedule,
                "MCP",
                "UAT",
                List.of(
                        SuiteBatchRunResult.builder().suiteName("ok").status("SUCCESS").build(),
                        SuiteBatchRunResult.builder().suiteName("bad").status("FAILURE").build()),
                batchId,
                "PARTIAL_FAILURE");

        assertEquals("custom.event", event.getEventName());
        assertEquals("biz-1", event.getBusinessId());
        assertEquals("ci", event.getOperator());
        assertTrue(event.getTimestamp() > 0);
        assertEquals("COLLECTION", event.getLabel().get("scopeType"));
        assertEquals("MCP", event.getLabel().get("scopeName"));
        assertEquals("PARTIAL_FAILURE", event.getLabel().get("status"));
        assertEquals(2, event.getLabel().get("suiteTotal"));
        assertEquals(1, event.getLabel().get("suiteSuccess"));
        assertEquals(1, event.getLabel().get("suiteFailed"));
        assertEquals("bad", event.getLabel().get("failedSuiteNames"));
        assertEquals("platform", event.getLabel().get("team"));
        assertEquals("PARTIAL_FAILURE", event.getLabel().get("status"));
        assertEquals("https://example.com/orchestapi/runs?tab=batches&batchId=" + batchId,
                event.getLabel().get("runsUrl"));
        assertFalse(event.getEventId().isBlank());
    }
}
