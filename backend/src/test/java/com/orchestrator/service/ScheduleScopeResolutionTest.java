package com.orchestrator.service;

import com.orchestrator.exception.NotFoundException;
import com.orchestrator.model.ApiCollection;
import com.orchestrator.model.Project;
import com.orchestrator.model.TestSuite;
import com.orchestrator.model.enums.ScheduleScopeType;
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

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ScheduleScopeResolutionTest {

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
                runProgressRegistry);
    }

    @Test
    void resolveSuiteReturnsSingleTarget() {
        UUID suiteId = UUID.randomUUID();
        TestSuite suite = TestSuite.builder().id(suiteId).name("A").build();
        when(suiteRepository.findById(suiteId)).thenReturn(Optional.of(suite));

        List<TestSuite> targets = scheduleService.resolveTargetSuites(ScheduleScopeType.SUITE, suiteId);

        assertEquals(List.of(suite), targets);
    }

    @Test
    void resolveCollectionReturnsSuitesOrderedByName() {
        UUID collectionId = UUID.randomUUID();
        when(collectionRepository.findById(collectionId))
                .thenReturn(Optional.of(ApiCollection.builder().id(collectionId).name("MCP").build()));
        TestSuite s1 = TestSuite.builder().id(UUID.randomUUID()).name("alpha").collectionId(collectionId).build();
        TestSuite s2 = TestSuite.builder().id(UUID.randomUUID()).name("beta").collectionId(collectionId).build();
        when(suiteRepository.findByCollectionIdOrderByNameAsc(collectionId)).thenReturn(List.of(s1, s2));

        List<TestSuite> targets = scheduleService.resolveTargetSuites(ScheduleScopeType.COLLECTION, collectionId);

        assertEquals(List.of(s1, s2), targets);
    }

    @Test
    void resolveEmptyCollectionIsEmptySuccessAnalog() {
        UUID collectionId = UUID.randomUUID();
        when(collectionRepository.findById(collectionId))
                .thenReturn(Optional.of(ApiCollection.builder().id(collectionId).name("Empty").build()));
        when(suiteRepository.findByCollectionIdOrderByNameAsc(collectionId)).thenReturn(List.of());

        List<TestSuite> targets = scheduleService.resolveTargetSuites(ScheduleScopeType.COLLECTION, collectionId);

        assertTrue(targets.isEmpty());
    }

    @Test
    void resolveProjectFlattensCollectionsInNameOrder() {
        UUID projectId = UUID.randomUUID();
        UUID c1 = UUID.randomUUID();
        UUID c2 = UUID.randomUUID();
        when(projectRepository.findById(projectId))
                .thenReturn(Optional.of(Project.builder().id(projectId).name("Agent").build()));
        when(collectionRepository.findByProjectIdOrderByNameAsc(projectId)).thenReturn(List.of(
                ApiCollection.builder().id(c1).name("A").projectId(projectId).build(),
                ApiCollection.builder().id(c2).name("B").projectId(projectId).build()
        ));
        TestSuite a1 = TestSuite.builder().id(UUID.randomUUID()).name("a1").collectionId(c1).build();
        TestSuite b1 = TestSuite.builder().id(UUID.randomUUID()).name("b1").collectionId(c2).build();
        when(suiteRepository.findByCollectionIdOrderByNameAsc(c1)).thenReturn(List.of(a1));
        when(suiteRepository.findByCollectionIdOrderByNameAsc(c2)).thenReturn(List.of(b1));

        List<TestSuite> targets = scheduleService.resolveTargetSuites(ScheduleScopeType.PROJECT, projectId);

        assertEquals(List.of(a1, b1), targets);
    }

    @Test
    void resolveMissingScopeThrows() {
        UUID missing = UUID.randomUUID();
        when(collectionRepository.findById(missing)).thenReturn(Optional.empty());

        assertThrows(NotFoundException.class,
                () -> scheduleService.resolveTargetSuites(ScheduleScopeType.COLLECTION, missing));
    }
}
