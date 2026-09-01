package com.orchestrator.service;

import com.orchestrator.dto.PageResponse;
import com.orchestrator.dto.ScheduleNotifyLogResponse;
import com.orchestrator.exception.NotFoundException;
import com.orchestrator.model.ScheduleNotifyLog;
import com.orchestrator.repository.ScheduleNotifyLogRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ScheduleNotifyLogService {

    private final ScheduleNotifyLogRepository repository;

    @Transactional(readOnly = true)
    public PageResponse<ScheduleNotifyLogResponse> findAll(UUID scheduleId, Boolean success, Pageable pageable) {
        Specification<ScheduleNotifyLog> spec = Specification.where(null);
        if (scheduleId != null) {
            spec = spec.and((root, query, cb) -> cb.equal(root.get("scheduleId"), scheduleId));
        }
        if (success != null) {
            spec = spec.and((root, query, cb) -> cb.equal(root.get("success"), success));
        }
        Page<ScheduleNotifyLog> page = repository.findAll(spec, pageable);
        return PageResponse.from(page, this::toResponse);
    }

    @Transactional(readOnly = true)
    public ScheduleNotifyLogResponse findById(UUID id) {
        ScheduleNotifyLog log = repository.findById(id)
                .orElseThrow(() -> new NotFoundException("Notify log not found: " + id));
        return toResponse(log);
    }

    private ScheduleNotifyLogResponse toResponse(ScheduleNotifyLog log) {
        return ScheduleNotifyLogResponse.builder()
                .id(log.getId().toString())
                .scheduleId(log.getScheduleId() != null ? log.getScheduleId().toString() : null)
                .eventId(log.getEventId())
                .eventName(log.getEventName())
                .businessId(log.getBusinessId())
                .notifyUrl(log.getNotifyUrl())
                .success(log.getSuccess())
                .httpStatus(log.getHttpStatus())
                .requestBody(log.getRequestBody())
                .responseBody(log.getResponseBody())
                .errorMessage(log.getErrorMessage())
                .durationMs(log.getDurationMs())
                .batchId(log.getBatchId() != null ? log.getBatchId().toString() : null)
                .runStatus(log.getRunStatus())
                .createdAt(log.getCreatedAt())
                .build();
    }
}
