package com.orchestrator.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.orchestrator.dto.ExternalNotifyEvent;
import com.orchestrator.dto.SuiteBatchRunResult;
import com.orchestrator.model.RunSchedule;
import com.orchestrator.model.ScheduleNotifyLog;
import com.orchestrator.model.enums.ScheduleNotifyOn;
import com.orchestrator.model.enums.ScheduleScopeType;
import com.orchestrator.repository.ScheduleNotifyLogRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

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
    private static final int MAX_BODY_CHARS = 64_000;

    private final RestClient restClient;
    private final String publicBaseUrl;
    private final ScheduleNotifyLogRepository notifyLogRepository;
    private final ObjectMapper objectMapper;

    public ScheduleNotifyService(
            RestClient.Builder restClientBuilder,
            @Value("${orchestapi.public-base-url:}") String publicBaseUrl,
            ScheduleNotifyLogRepository notifyLogRepository,
            ObjectMapper objectMapper) {
        this.restClient = restClientBuilder.build();
        this.publicBaseUrl = publicBaseUrl == null ? "" : publicBaseUrl.trim().replaceAll("/+$", "");
        this.notifyLogRepository = notifyLogRepository;
        this.objectMapper = objectMapper;
    }

    /**
     * Best-effort notify. Failures are logged/persisted and never thrown to callers.
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
                persistLog(ScheduleNotifyLog.builder()
                        .scheduleId(schedule.getId())
                        .notifyUrl("")
                        .success(false)
                        .errorMessage("notifyUrl is empty")
                        .runStatus(resolveOverallStatus(results))
                        .batchId(batchId)
                        .build());
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
            postEvent(schedule, event, status, batchId);
        } catch (Exception e) {
            log.error("Failed to notify for schedule {}: {}",
                    schedule != null ? schedule.getId() : null, e.getMessage(), e);
            if (schedule != null) {
                persistLog(ScheduleNotifyLog.builder()
                        .scheduleId(schedule.getId())
                        .notifyUrl(schedule.getNotifyUrl() != null ? schedule.getNotifyUrl() : "")
                        .success(false)
                        .errorMessage(e.getMessage())
                        .batchId(batchId)
                        .runStatus(resolveOverallStatus(results))
                        .build());
            }
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

    private void postEvent(RunSchedule schedule, ExternalNotifyEvent event, String runStatus, UUID batchId) {
        String url = schedule.getNotifyUrl().trim();
        String requestBody = serialize(event);
        long started = System.currentTimeMillis();
        ScheduleNotifyLog.ScheduleNotifyLogBuilder logBuilder = ScheduleNotifyLog.builder()
                .scheduleId(schedule.getId())
                .eventId(event.getEventId())
                .eventName(event.getEventName())
                .businessId(event.getBusinessId())
                .notifyUrl(url)
                .requestBody(truncate(requestBody))
                .runStatus(runStatus)
                .batchId(batchId);

        try {
            ResponseEntity<String> response = restClient.post()
                    .uri(url)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(event)
                    .retrieve()
                    .toEntity(String.class);
            boolean ok = response.getStatusCode().is2xxSuccessful();
            persistLog(logBuilder
                    .success(ok)
                    .httpStatus(response.getStatusCode().value())
                    .responseBody(truncate(response.getBody()))
                    .errorMessage(ok ? null : "Non-2xx response")
                    .durationMs(System.currentTimeMillis() - started)
                    .build());
            log.info("Posted schedule notify event {} to {} (http={}, runStatus={})",
                    event.getEventId(), url, response.getStatusCode().value(), runStatus);
        } catch (RestClientResponseException e) {
            persistLog(logBuilder
                    .success(false)
                    .httpStatus(e.getStatusCode().value())
                    .responseBody(truncate(e.getResponseBodyAsString()))
                    .errorMessage(e.getMessage())
                    .durationMs(System.currentTimeMillis() - started)
                    .build());
            log.error("Notify HTTP error for schedule {}: {}", schedule.getId(), e.getMessage());
        } catch (Exception e) {
            persistLog(logBuilder
                    .success(false)
                    .errorMessage(e.getMessage())
                    .durationMs(System.currentTimeMillis() - started)
                    .build());
            log.error("Notify failed for schedule {}: {}", schedule.getId(), e.getMessage());
        }
    }

    private void persistLog(ScheduleNotifyLog entry) {
        try {
            notifyLogRepository.save(entry);
        } catch (Exception e) {
            log.error("Failed to persist notify log: {}", e.getMessage(), e);
        }
    }

    private String serialize(ExternalNotifyEvent event) {
        try {
            return objectMapper.writeValueAsString(event);
        } catch (Exception e) {
            return "{\"error\":\"failed to serialize notify event\"}";
        }
    }

    private static String truncate(String value) {
        if (value == null) return null;
        if (value.length() <= MAX_BODY_CHARS) return value;
        return value.substring(0, MAX_BODY_CHARS) + "…[truncated]";
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
