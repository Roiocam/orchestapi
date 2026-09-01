package com.orchestrator.service;

import com.orchestrator.dto.CronPreviewResponse;
import com.orchestrator.repository.ApiCollectionRepository;
import com.orchestrator.repository.EnvironmentRepository;
import com.orchestrator.repository.ProjectRepository;
import com.orchestrator.repository.RunScheduleRepository;
import com.orchestrator.repository.TestSuiteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.support.CronExpression;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(MockitoExtension.class)
class ScheduleCronTimezoneTest {

    private static final ZoneId SHANGHAI = ZoneId.of("Asia/Shanghai");

    @Mock RunScheduleRepository scheduleRepository;
    @Mock TestSuiteRepository suiteRepository;
    @Mock ApiCollectionRepository collectionRepository;
    @Mock ProjectRepository projectRepository;
    @Mock EnvironmentRepository environmentRepository;
    @Mock RunService runService;
    @Mock ExecutionService executionService;
    @Mock TaskScheduler taskScheduler;
    @Mock BatchExecutionService batchExecutionService;
    @Mock ScheduleNotifyService scheduleNotifyService;
    @Mock RunProgressRegistry runProgressRegistry;

    ScheduleService scheduleService;

    @BeforeEach
    void setUp() {
        scheduleService = new ScheduleService(
                scheduleRepository,
                suiteRepository,
                collectionRepository,
                projectRepository,
                environmentRepository,
                runService,
                executionService,
                taskScheduler,
                batchExecutionService,
                scheduleNotifyService,
                runProgressRegistry,
                SHANGHAI);
    }

    @Test
    void previewReportsTimezoneAndFireTimesInUtcMatchingShanghaiWallClock() {
        CronPreviewResponse response = scheduleService.preview("0 0 9-18 * * 1-5");

        assertTrue(response.isValid());
        assertEquals("Asia/Shanghai", response.getTimezone());
        assertFalse(response.getNextFireTimes().isEmpty());

        for (LocalDateTime utcFire : response.getNextFireTimes()) {
            ZonedDateTime shanghai = utcFire.atOffset(ZoneOffset.UTC).atZoneSameInstant(SHANGHAI);
            assertTrue(shanghai.getHour() >= 9 && shanghai.getHour() <= 18,
                    "hour should be business hour in Asia/Shanghai, got " + shanghai);
            assertEquals(0, shanghai.getMinute());
            assertEquals(0, shanghai.getSecond());
            int dow = shanghai.getDayOfWeek().getValue(); // 1=Mon .. 7=Sun
            assertTrue(dow >= 1 && dow <= 5, "should be weekday, got " + shanghai.getDayOfWeek());
        }
    }

    @Test
    void cronExpressionNextInShanghaiConvertsToExpectedUtc() {
        // Monday 08:30 Shanghai → next 09:00 Shanghai = 01:00 UTC
        ZonedDateTime from = ZonedDateTime.of(2026, 3, 2, 8, 30, 0, 0, SHANGHAI);
        ZonedDateTime next = CronExpression.parse("0 0 9-18 * * 1-5").next(from);
        assertNotNull(next);
        assertEquals(LocalDateTime.of(2026, 3, 2, 1, 0, 0),
                next.withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime());
    }

    @Test
    void previewRejectsInvalidCronButStillReportsTimezone() {
        CronPreviewResponse response = scheduleService.preview("not-a-cron");
        assertFalse(response.isValid());
        assertEquals("Asia/Shanghai", response.getTimezone());
    }
}
