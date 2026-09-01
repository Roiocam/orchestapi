package com.orchestrator.service;

import com.orchestrator.dto.ExternalNotifyEvent;
import com.orchestrator.dto.SuiteBatchRunResult;
import com.orchestrator.model.RunSchedule;
import com.orchestrator.model.enums.ScheduleNotifyOn;
import com.orchestrator.model.enums.ScheduleScopeType;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@Slf4j
public class ScheduleNotifyService {

    public static final String DEFAULT_EVENT_NAME = "orchestapi.schedule.run";
    public static final String DEFAULT_OPERATOR = "orchestapi";

    private final RestClient restClient;
    private final String publicBaseUrl;

    public ScheduleNotifyService(
            RestClient.Builder restClientBuilder,
            @Value("${orchestapi.public-base-url:}") String publicBaseUrl) {
        this.restClient = restClientBuilder.build();
        this.publicBaseUrl = publicBaseUrl == null ? "" : publicBaseUrl.trim().replaceAll("/+$", "");
    }

    /**
     * Best-effort notify. Failures are logged and never thrown to callers.
     */
    public void notifyIfNeeded(RunSchedule schedule,
                               String scopeName,
                               String environmentName,
                               List<SuiteBatchRunResult> results,
                               UUID batchId) {
        try {
            if (schedule == null || !Boolean.TRUE.equals(schedule.getNotifyEnabled())) {
                return;
            }
            if (schedule.getNotifyUrl() == null || schedule.getNotifyUrl().isBlank()) {
                log.warn("Schedule {} has notifyEnabled but notifyUrl is empty — skipping", schedule.getId());
                return;
            }

            String status = resolveOverallStatus(results);
            ScheduleNotifyOn notifyOn = schedule.getNotifyOn() != null
                    ? schedule.getNotifyOn()
                    : ScheduleNotifyOn.ON_FAILURE;
            if (notifyOn == ScheduleNotifyOn.ON_FAILURE && "SUCCESS".equals(status)) {
                log.debug("Skipping notify for schedule {} — status SUCCESS and notifyOn=ON_FAILURE", schedule.getId());
                return;
            }

            ExternalNotifyEvent event = buildEvent(schedule, scopeName, environmentName, results, batchId, status);
            postEvent(schedule.getNotifyUrl().trim(), event);
        } catch (Exception e) {
            log.error("Failed to notify for schedule {}: {}",
                    schedule != null ? schedule.getId() : null, e.getMessage(), e);
        }
    }

    ExternalNotifyEvent buildEvent(RunSchedule schedule,
                                   String scopeName,
                                   String environmentName,
                                   List<SuiteBatchRunResult> results,
                                   UUID batchId,
                                   String status) {
        List<SuiteBatchRunResult> safeResults = results != null ? results : List.of();
        int suiteTotal = safeResults.size();
        int suiteSuccess = (int) safeResults.stream().filter(r -> "SUCCESS".equals(r.getStatus())).count();
        int suiteFailed = suiteTotal - suiteSuccess;
        String failedNames = safeResults.stream()
                .filter(r -> !"SUCCESS".equals(r.getStatus()))
                .map(SuiteBatchRunResult::getSuiteName)
                .filter(n -> n != null && !n.isBlank())
                .collect(Collectors.joining(","));

        ScheduleScopeType scopeType = schedule.getScopeType() != null
                ? schedule.getScopeType()
                : ScheduleScopeType.SUITE;
        UUID scopeId = schedule.getScopeId() != null ? schedule.getScopeId() : schedule.getSuiteId();

        Map<String, Object> label = new LinkedHashMap<>();
        label.put("scopeType", scopeType.name());
        label.put("scopeId", scopeId != null ? scopeId.toString() : "");
        label.put("scopeName", scopeName != null ? scopeName : "");
        label.put("environmentId", schedule.getEnvironmentId() != null ? schedule.getEnvironmentId().toString() : "");
        label.put("environmentName", environmentName != null ? environmentName : "");
        label.put("status", status);
        label.put("suiteTotal", suiteTotal);
        label.put("suiteSuccess", suiteSuccess);
        label.put("suiteFailed", suiteFailed);
        label.put("cronExpression", schedule.getCronExpression() != null ? schedule.getCronExpression() : "");
        label.put("scheduleId", schedule.getId() != null ? schedule.getId().toString() : "");
        label.put("failedSuiteNames", failedNames);
        if (batchId != null) {
            label.put("batchId", batchId.toString());
        }
        String runsUrl = buildRunsUrl(schedule.getId(), batchId);
        if (runsUrl != null) {
            label.put("runsUrl", runsUrl);
        }

        if (schedule.getNotifyExtraLabels() != null) {
            for (Map.Entry<String, String> entry : schedule.getNotifyExtraLabels().entrySet()) {
                if (entry.getKey() == null || entry.getKey().isBlank()) continue;
                // Extra labels add custom keys; do not override system keys.
                label.putIfAbsent(entry.getKey(), entry.getValue() != null ? entry.getValue() : "");
            }
        }

        String eventName = blankToNull(schedule.getNotifyEventName());
        if (eventName == null) {
            eventName = DEFAULT_EVENT_NAME;
        }
        String businessId = blankToNull(schedule.getNotifyBusinessId());
        if (businessId == null) {
            businessId = schedule.getId() != null ? schedule.getId().toString() : UUID.randomUUID().toString();
        }
        String operator = blankToNull(schedule.getNotifyOperator());
        if (operator == null) {
            operator = DEFAULT_OPERATOR;
        }

        return ExternalNotifyEvent.builder()
                .eventId(UUID.randomUUID().toString())
                .businessId(businessId)
                .eventName(eventName)
                .timestamp(System.currentTimeMillis())
                .operator(operator)
                .label(label)
                .build();
    }

    static String resolveOverallStatus(List<SuiteBatchRunResult> results) {
        if (results == null || results.isEmpty()) {
            return "SUCCESS";
        }
        int success = (int) results.stream().filter(r -> "SUCCESS".equals(r.getStatus())).count();
        int failed = results.size() - success;
        if (failed == 0) return "SUCCESS";
        if (success == 0) return "FAILURE";
        return "PARTIAL_FAILURE";
    }

    private void postEvent(String url, ExternalNotifyEvent event) {
        restClient.post()
                .uri(url)
                .contentType(MediaType.APPLICATION_JSON)
                .body(event)
                .retrieve()
                .toBodilessEntity();
        log.info("Posted schedule notify event {} to {} (status={})",
                event.getEventId(), url, event.getLabel().get("status"));
    }

    private String buildRunsUrl(UUID scheduleId, UUID batchId) {
        if (publicBaseUrl.isEmpty()) {
            return null;
        }
        if (batchId != null) {
            return publicBaseUrl + "/runs?tab=batches&batchId=" + batchId;
        }
        if (scheduleId != null) {
            return publicBaseUrl + "/runs?tab=history";
        }
        return publicBaseUrl + "/runs";
    }

    private static String blankToNull(String value) {
        if (value == null || value.isBlank()) return null;
        return value.trim();
    }
}
