package com.orchestrator.service;

import com.orchestrator.dto.CronPreviewResponse;
import com.orchestrator.dto.PageResponse;
import com.orchestrator.dto.RunScheduleRequest;
import com.orchestrator.dto.RunScheduleResponse;
import com.orchestrator.dto.SuiteExecutionResult;
import com.orchestrator.exception.NotFoundException;
import com.orchestrator.model.ApiCollection;
import com.orchestrator.model.Environment;
import com.orchestrator.model.Project;
import com.orchestrator.model.RunSchedule;
import com.orchestrator.model.TestRun;
import com.orchestrator.model.TestSuite;
import com.orchestrator.model.enums.ScheduleScopeType;
import com.orchestrator.model.enums.TriggerType;
import com.orchestrator.repository.ApiCollectionRepository;
import com.orchestrator.repository.EnvironmentRepository;
import com.orchestrator.repository.ProjectRepository;
import com.orchestrator.repository.RunScheduleRepository;
import com.orchestrator.repository.TestSuiteRepository;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Lazy;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.scheduling.support.CronTrigger;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;

@Service
@Slf4j
public class ScheduleService {

    private final RunScheduleRepository repository;
    private final TestSuiteRepository suiteRepository;
    private final ApiCollectionRepository collectionRepository;
    private final ProjectRepository projectRepository;
    private final EnvironmentRepository environmentRepository;
    private final RunService runService;
    private final ExecutionService executionService;
    private final TaskScheduler taskScheduler;

    private final ConcurrentHashMap<UUID, ScheduledFuture<?>> scheduledTasks = new ConcurrentHashMap<>();

    public ScheduleService(RunScheduleRepository repository,
                           TestSuiteRepository suiteRepository,
                           ApiCollectionRepository collectionRepository,
                           ProjectRepository projectRepository,
                           EnvironmentRepository environmentRepository,
                           RunService runService,
                           @Lazy ExecutionService executionService,
                           TaskScheduler taskScheduler) {
        this.repository = repository;
        this.suiteRepository = suiteRepository;
        this.collectionRepository = collectionRepository;
        this.projectRepository = projectRepository;
        this.environmentRepository = environmentRepository;
        this.runService = runService;
        this.executionService = executionService;
        this.taskScheduler = taskScheduler;
    }

    @PostConstruct
    public void loadSchedulesOnStartup() {
        List<RunSchedule> active = repository.findAllActive();
        for (RunSchedule schedule : active) {
            registerTask(schedule);
        }
        log.info("Loaded {} active schedules on startup", active.size());
    }

    // ── CRUD ──────────────────────────────────────────────────────────────

    @Transactional
    public RunScheduleResponse create(RunScheduleRequest req) {
        ResolvedScope scope = resolveAndValidateScope(req);
        Environment env = requireEnvironment(req.getEnvironmentId());
        String cron = validateCron(req.getCronExpression());

        RunSchedule schedule = RunSchedule.builder()
                .scopeType(scope.type())
                .scopeId(scope.id())
                .suiteId(scope.type() == ScheduleScopeType.SUITE ? scope.id() : null)
                .environmentId(env.getId())
                .cronExpression(cron)
                .description(req.getDescription())
                .active(true)
                .nextRunAt(computeNextRunAt(cron))
                .build();

        schedule = repository.save(schedule);
        registerTask(schedule);

        return toResponse(schedule);
    }

    @Transactional(readOnly = true)
    public PageResponse<RunScheduleResponse> findAll(Pageable pageable) {
        Page<RunSchedule> page = repository.findAll(pageable);
        return PageResponse.from(page, this::toResponse);
    }

    @Transactional(readOnly = true)
    public List<RunScheduleResponse> findBySuiteId(UUID suiteId) {
        return repository.findBySuiteId(suiteId).stream()
                .map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public long countActive() {
        return repository.findAllActive().size();
    }

    @Transactional(readOnly = true)
    public RunScheduleResponse findById(UUID id) {
        RunSchedule schedule = repository.findById(id)
                .orElseThrow(() -> new NotFoundException("Schedule not found: " + id));
        return toResponse(schedule);
    }

    @Transactional
    public RunScheduleResponse update(UUID id, RunScheduleRequest req) {
        RunSchedule schedule = repository.findById(id)
                .orElseThrow(() -> new NotFoundException("Schedule not found: " + id));

        ResolvedScope scope = resolveAndValidateScope(req);
        requireEnvironment(req.getEnvironmentId());
        String cron = validateCron(req.getCronExpression());

        cancelTask(schedule.getId());

        schedule.setScopeType(scope.type());
        schedule.setScopeId(scope.id());
        schedule.setSuiteId(scope.type() == ScheduleScopeType.SUITE ? scope.id() : null);
        schedule.setEnvironmentId(req.getEnvironmentId());
        schedule.setCronExpression(cron);
        schedule.setDescription(req.getDescription());
        schedule.setNextRunAt(schedule.getActive() ? computeNextRunAt(cron) : null);

        schedule = repository.save(schedule);

        if (schedule.getActive()) {
            registerTask(schedule);
        }

        return toResponse(schedule);
    }

    @Transactional
    public void delete(UUID id) {
        RunSchedule schedule = repository.findById(id)
                .orElseThrow(() -> new NotFoundException("Schedule not found: " + id));
        cancelTask(id);
        schedule.setDeletedAt(LocalDateTime.now());
        repository.save(schedule);
    }

    @Transactional
    public RunScheduleResponse toggle(UUID id) {
        RunSchedule schedule = repository.findById(id)
                .orElseThrow(() -> new NotFoundException("Schedule not found: " + id));

        boolean newActive = !schedule.getActive();
        schedule.setActive(newActive);

        if (newActive) {
            schedule.setNextRunAt(computeNextRunAt(schedule.getCronExpression()));
            schedule = repository.save(schedule);
            registerTask(schedule);
        } else {
            schedule.setNextRunAt(null);
            schedule = repository.save(schedule);
            cancelTask(id);
        }

        return toResponse(schedule);
    }

    // ── Cron preview ──────────────────────────────────────────────────────

    public CronPreviewResponse preview(String cronExpression) {
        try {
            CronExpression cron = CronExpression.parse(normalizeCron(cronExpression));
            List<LocalDateTime> fireTimes = new ArrayList<>();
            LocalDateTime next = LocalDateTime.now();
            for (int i = 0; i < 5; i++) {
                next = cron.next(next);
                if (next == null) break;
                fireTimes.add(next);
            }
            return CronPreviewResponse.builder()
                    .valid(true)
                    .nextFireTimes(fireTimes)
                    .build();
        } catch (IllegalArgumentException e) {
            return CronPreviewResponse.builder()
                    .valid(false)
                    .error(e.getMessage())
                    .build();
        }
    }

    // ── Task scheduling ───────────────────────────────────────────────────

    private void registerTask(RunSchedule schedule) {
        cancelTask(schedule.getId());
        try {
            CronTrigger trigger = new CronTrigger(normalizeCron(schedule.getCronExpression()));
            ScheduledFuture<?> future = taskScheduler.schedule(
                    () -> executeScheduledRun(schedule.getId()),
                    trigger);
            scheduledTasks.put(schedule.getId(), future);
        } catch (Exception e) {
            log.error("Failed to register schedule {}: {}", schedule.getId(), e.getMessage());
        }
    }

    private void cancelTask(UUID scheduleId) {
        ScheduledFuture<?> future = scheduledTasks.remove(scheduleId);
        if (future != null) {
            future.cancel(false);
        }
    }

    private void executeScheduledRun(UUID scheduleId) {
        RunSchedule schedule = repository.findById(scheduleId).orElse(null);
        if (schedule == null || !schedule.getActive()) {
            cancelTask(scheduleId);
            return;
        }

        List<TestSuite> targets;
        try {
            targets = resolveTargetSuites(schedule.getScopeType(), schedule.getScopeId());
        } catch (NotFoundException e) {
            log.error("Scheduled run skipped — scope missing for schedule {}: {}", scheduleId, e.getMessage());
            touchScheduleTimestamps(schedule);
            return;
        }

        // Empty scope mirrors empty suite: treat as successful no-op (no failure).
        if (targets.isEmpty()) {
            log.info("Scheduled run for {} {} has no suites — completing as empty success (schedule {})",
                    schedule.getScopeType(), schedule.getScopeId(), scheduleId);
            touchScheduleTimestamps(schedule);
            return;
        }

        // Same as suite steps: keep going after a failure so the batch finishes.
        for (TestSuite suite : targets) {
            UUID runId = null;
            try {
                TestRun run = runService.createRun(
                        suite.getId(),
                        schedule.getEnvironmentId(),
                        TriggerType.SCHEDULED,
                        scheduleId);
                runId = run.getId();

                ExecutionService.PreparedExecution prepared =
                        executionService.prepareSuiteRun(suite.getId(), schedule.getEnvironmentId());
                SuiteExecutionResult result = executionService.executePreparedNonInteractive(prepared);
                runService.completeRun(runId, result);

                log.info("Scheduled suite {} completed for schedule {}: {}",
                        suite.getId(), scheduleId, result.getStatus());
            } catch (Exception e) {
                log.error("Scheduled suite {} failed for schedule {}: {}",
                        suite.getId(), scheduleId, e.getMessage(), e);
                if (runId != null) {
                    runService.failRun(runId, e.getMessage());
                }
            }
        }

        touchScheduleTimestamps(schedule);
    }

    private void touchScheduleTimestamps(RunSchedule schedule) {
        try {
            schedule.setLastRunAt(LocalDateTime.now());
            schedule.setNextRunAt(computeNextRunAt(schedule.getCronExpression()));
            repository.save(schedule);
        } catch (Exception ex) {
            log.error("Failed to update schedule timestamps: {}", ex.getMessage());
        }
    }

    // ── Scope resolution ──────────────────────────────────────────────────

    private record ResolvedScope(ScheduleScopeType type, UUID id) {}

    private ResolvedScope resolveAndValidateScope(RunScheduleRequest req) {
        ScheduleScopeType type;
        UUID scopeId;

        if (req.getScopeType() != null && !req.getScopeType().isBlank()) {
            try {
                type = ScheduleScopeType.valueOf(req.getScopeType().trim().toUpperCase());
            } catch (IllegalArgumentException e) {
                throw new IllegalArgumentException(
                        "Invalid scopeType: " + req.getScopeType() + " (expected SUITE, COLLECTION, or PROJECT)");
            }
            scopeId = req.getScopeId() != null ? req.getScopeId() : req.getSuiteId();
            if (scopeId == null) {
                throw new IllegalArgumentException("scopeId is required when scopeType is set");
            }
        } else if (req.getSuiteId() != null) {
            type = ScheduleScopeType.SUITE;
            scopeId = req.getSuiteId();
        } else if (req.getScopeId() != null) {
            type = ScheduleScopeType.SUITE;
            scopeId = req.getScopeId();
        } else {
            throw new IllegalArgumentException("scopeType + scopeId (or legacy suiteId) is required");
        }

        switch (type) {
            case SUITE -> suiteRepository.findById(scopeId)
                    .orElseThrow(() -> new NotFoundException("Test suite not found: " + scopeId));
            case COLLECTION -> collectionRepository.findById(scopeId)
                    .orElseThrow(() -> new NotFoundException("Collection not found: " + scopeId));
            case PROJECT -> projectRepository.findById(scopeId)
                    .orElseThrow(() -> new NotFoundException("Project not found: " + scopeId));
        }

        return new ResolvedScope(type, scopeId);
    }

    /**
     * Expand schedule scope to ordered suite targets.
     * Collection: suites in that collection by name.
     * Project: collections by name, then suites by name within each.
     */
    List<TestSuite> resolveTargetSuites(ScheduleScopeType type, UUID scopeId) {
        return switch (type) {
            case SUITE -> {
                TestSuite suite = suiteRepository.findById(scopeId)
                        .orElseThrow(() -> new NotFoundException("Test suite not found: " + scopeId));
                yield List.of(suite);
            }
            case COLLECTION -> {
                collectionRepository.findById(scopeId)
                        .orElseThrow(() -> new NotFoundException("Collection not found: " + scopeId));
                yield suiteRepository.findByCollectionIdOrderByNameAsc(scopeId);
            }
            case PROJECT -> {
                projectRepository.findById(scopeId)
                        .orElseThrow(() -> new NotFoundException("Project not found: " + scopeId));
                List<ApiCollection> collections = collectionRepository.findByProjectIdOrderByNameAsc(scopeId);
                List<TestSuite> suites = new ArrayList<>();
                for (ApiCollection collection : collections) {
                    suites.addAll(suiteRepository.findByCollectionIdOrderByNameAsc(collection.getId()));
                }
                yield suites;
            }
        };
    }

    private Environment requireEnvironment(UUID environmentId) {
        return environmentRepository.findById(environmentId)
                .orElseThrow(() -> new NotFoundException("Environment not found: " + environmentId));
    }

    private String validateCron(String cronExpression) {
        String cron = normalizeCron(cronExpression);
        try {
            CronExpression.parse(cron);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid cron expression: " + e.getMessage());
        }
        return cron;
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    private String normalizeCron(String cronExpression) {
        String trimmed = cronExpression.trim();
        String[] fields = trimmed.split("\\s+");
        if (fields.length == 5) {
            return "0 " + trimmed;
        }
        return trimmed;
    }

    private LocalDateTime computeNextRunAt(String cronExpression) {
        try {
            CronExpression cron = CronExpression.parse(normalizeCron(cronExpression));
            return cron.next(LocalDateTime.now());
        } catch (Exception e) {
            return null;
        }
    }

    private RunScheduleResponse toResponse(RunSchedule schedule) {
        ScheduleScopeType type = schedule.getScopeType() != null
                ? schedule.getScopeType()
                : ScheduleScopeType.SUITE;
        UUID scopeId = schedule.getScopeId() != null ? schedule.getScopeId() : schedule.getSuiteId();
        ScopeDisplay display = resolveScopeDisplay(type, scopeId);

        return RunScheduleResponse.builder()
                .id(schedule.getId().toString())
                .scopeType(type.name())
                .scopeId(scopeId != null ? scopeId.toString() : null)
                .scopeName(display.name())
                .suiteCount(display.suiteCount())
                .suiteId(type == ScheduleScopeType.SUITE && scopeId != null ? scopeId.toString() : null)
                .suiteName(type == ScheduleScopeType.SUITE ? display.name() : null)
                .environmentId(schedule.getEnvironmentId().toString())
                .environmentName(resolveEnvironmentName(schedule.getEnvironmentId()))
                .cronExpression(schedule.getCronExpression())
                .active(schedule.getActive())
                .description(schedule.getDescription())
                .lastRunAt(schedule.getLastRunAt())
                .nextRunAt(schedule.getNextRunAt())
                .createdAt(schedule.getCreatedAt())
                .updatedAt(schedule.getUpdatedAt())
                .build();
    }

    private record ScopeDisplay(String name, int suiteCount) {}

    private ScopeDisplay resolveScopeDisplay(ScheduleScopeType type, UUID scopeId) {
        if (scopeId == null) {
            return new ScopeDisplay("Unknown", 0);
        }
        try {
            return switch (type) {
                case SUITE -> {
                    String name = suiteRepository.findById(scopeId).map(TestSuite::getName).orElse("Unknown suite");
                    yield new ScopeDisplay(name, 1);
                }
                case COLLECTION -> {
                    String name = collectionRepository.findById(scopeId).map(ApiCollection::getName).orElse("Unknown collection");
                    int count = (int) suiteRepository.countByCollectionId(scopeId);
                    yield new ScopeDisplay(name, count);
                }
                case PROJECT -> {
                    String name = projectRepository.findById(scopeId).map(Project::getName).orElse("Unknown project");
                    List<UUID> collectionIds = collectionRepository.findByProjectIdOrderByNameAsc(scopeId).stream()
                            .map(ApiCollection::getId)
                            .toList();
                    int count = collectionIds.isEmpty()
                            ? 0
                            : suiteRepository.findByCollectionIdInOrderByNameAsc(collectionIds).size();
                    yield new ScopeDisplay(name, count);
                }
            };
        } catch (Exception e) {
            return new ScopeDisplay("Unknown", 0);
        }
    }

    private String resolveEnvironmentName(UUID environmentId) {
        return environmentRepository.findById(environmentId)
                .map(Environment::getName)
                .orElse("Unknown");
    }
}
