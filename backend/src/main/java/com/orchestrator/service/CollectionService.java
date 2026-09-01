package com.orchestrator.service;

import com.orchestrator.dto.BatchStartResponse;
import com.orchestrator.dto.CollectionRequest;
import com.orchestrator.dto.CollectionResponse;
import com.orchestrator.dto.RunRequest;
import com.orchestrator.exception.NotFoundException;
import com.orchestrator.model.ApiCollection;
import com.orchestrator.model.DefaultHierarchyIds;
import com.orchestrator.model.TestSuite;
import com.orchestrator.model.enums.ScheduleScopeType;
import com.orchestrator.repository.ApiCollectionRepository;
import com.orchestrator.repository.ProjectRepository;
import com.orchestrator.repository.TestSuiteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class CollectionService {

    private final ApiCollectionRepository repository;
    private final ProjectRepository projectRepository;
    private final TestSuiteRepository suiteRepository;
    private final ScheduleService scheduleService;
    private final BatchExecutionService batchExecutionService;

    @Transactional(readOnly = true)
    public List<CollectionResponse> findAll(UUID projectId) {
        List<ApiCollection> collections = projectId != null
                ? repository.findByProjectIdOrderByNameAsc(projectId)
                : repository.findAllByOrderByNameAsc();
        return collections.stream()
                .map(c -> CollectionResponse.from(c, (int) suiteRepository.countByCollectionId(c.getId())))
                .toList();
    }

    @Transactional(readOnly = true)
    public CollectionResponse findById(UUID id) {
        ApiCollection collection = repository.findById(id)
                .orElseThrow(() -> new NotFoundException("Collection not found: " + id));
        return CollectionResponse.from(collection, (int) suiteRepository.countByCollectionId(id));
    }

    @Transactional
    public CollectionResponse create(CollectionRequest request) {
        if (!projectRepository.existsById(request.getProjectId())) {
            throw new NotFoundException("Project not found: " + request.getProjectId());
        }
        if (repository.existsByProjectIdAndName(request.getProjectId(), request.getName())) {
            throw new IllegalArgumentException(
                    "Collection with name '" + request.getName() + "' already exists in this project");
        }
        ApiCollection collection = ApiCollection.builder()
                .projectId(request.getProjectId())
                .name(request.getName())
                .description(request.getDescription() != null ? request.getDescription() : "")
                .build();
        collection = repository.save(collection);
        return CollectionResponse.from(collection, 0);
    }

    @Transactional
    public CollectionResponse update(UUID id, CollectionRequest request) {
        ApiCollection collection = repository.findById(id)
                .orElseThrow(() -> new NotFoundException("Collection not found: " + id));
        if (!projectRepository.existsById(request.getProjectId())) {
            throw new NotFoundException("Project not found: " + request.getProjectId());
        }
        if (repository.existsByProjectIdAndNameAndIdNot(request.getProjectId(), request.getName(), id)) {
            throw new IllegalArgumentException(
                    "Collection with name '" + request.getName() + "' already exists in this project");
        }
        collection.setProjectId(request.getProjectId());
        collection.setName(request.getName());
        collection.setDescription(request.getDescription() != null ? request.getDescription() : "");
        collection = repository.save(collection);
        return CollectionResponse.from(collection, (int) suiteRepository.countByCollectionId(id));
    }

    public BatchStartResponse run(UUID id, RunRequest request) {
        ApiCollection collection = repository.findById(id)
                .orElseThrow(() -> new NotFoundException("Collection not found: " + id));
        UUID environmentId = request != null ? request.getEnvironmentId() : null;
        List<TestSuite> targets = scheduleService.resolveTargetSuites(ScheduleScopeType.COLLECTION, id);
        UUID batchId = batchExecutionService.createAndStartCollectionBatch(
                collection.getId(), collection.getName(), environmentId, targets);
        return BatchStartResponse.builder().batchId(batchId).build();
    }

    @Transactional
    public void delete(UUID id) {
        if (DefaultHierarchyIds.DEFAULT_COLLECTION_ID.equals(id)) {
            throw new IllegalArgumentException("Default collection cannot be deleted");
        }
        ApiCollection collection = repository.findById(id)
                .orElseThrow(() -> new NotFoundException("Collection not found: " + id));
        if (suiteRepository.countByCollectionId(id) > 0) {
            throw new IllegalArgumentException("Cannot delete collection that still has test suites");
        }
        collection.setDeletedAt(LocalDateTime.now());
        repository.save(collection);
    }
}
