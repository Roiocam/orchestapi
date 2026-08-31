package com.orchestrator.service;

import com.orchestrator.dto.*;
import com.orchestrator.exception.NotFoundException;
import com.orchestrator.model.DefaultHierarchyIds;
import com.orchestrator.model.TestSuite;
import com.orchestrator.repository.ApiCollectionRepository;
import com.orchestrator.repository.TestSuiteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class TestSuiteService {

    private final TestSuiteRepository repository;
    private final TestStepService stepService;
    private final ApiCollectionRepository collectionRepository;

    @Transactional(readOnly = true)
    public PageResponse<TestSuiteResponse> findAllPaged(
            String name, UUID projectId, UUID collectionId, Pageable pageable) {
        Specification<TestSuite> spec = Specification.where(null);

        if (name != null && !name.isBlank()) {
            spec = spec.and((root, query, cb) ->
                    cb.like(cb.lower(root.get("name")), "%" + name.toLowerCase() + "%"));
        }
        if (collectionId != null) {
            spec = spec.and((root, query, cb) ->
                    cb.equal(root.get("collectionId"), collectionId));
        } else if (projectId != null) {
            List<UUID> collectionIds = collectionRepository.findByProjectIdOrderByNameAsc(projectId).stream()
                    .map(c -> c.getId())
                    .toList();
            if (collectionIds.isEmpty()) {
                return PageResponse.from(Page.empty(pageable), TestSuiteResponse::from);
            }
            spec = spec.and((root, query, cb) -> root.get("collectionId").in(collectionIds));
        }

        Page<TestSuite> idPage = repository.findAll(spec, pageable);
        List<UUID> ids = idPage.getContent().stream().map(TestSuite::getId).toList();

        if (ids.isEmpty()) {
            return PageResponse.from(idPage, TestSuiteResponse::from);
        }

        List<TestSuite> withSteps = repository.findByIdsWithSteps(ids);

        Map<UUID, TestSuite> byId = withSteps.stream()
                .collect(Collectors.toMap(TestSuite::getId, Function.identity()));
        List<TestSuite> ordered = ids.stream().map(byId::get).toList();

        Page<TestSuite> fullPage = new PageImpl<>(ordered, pageable, idPage.getTotalElements());
        return PageResponse.from(fullPage, TestSuiteResponse::from);
    }

    @Transactional(readOnly = true)
    public TestSuiteResponse findById(UUID id) {
        TestSuite suite = repository.findByIdWithSteps(id)
                .orElseThrow(() -> new NotFoundException("Test suite not found: " + id));
        return TestSuiteResponse.from(suite);
    }

    @Transactional
    public TestSuiteResponse create(TestSuiteRequest request) {
        UUID collectionId = resolveCollectionId(request.getCollectionId());
        if (repository.existsByNameAndCollectionId(request.getName(), collectionId)) {
            throw new IllegalArgumentException("Test suite with name '" + request.getName() + "' already exists");
        }

        TestSuite suite = TestSuite.builder()
                .name(request.getName())
                .description(request.getDescription() != null ? request.getDescription() : "")
                .collectionId(collectionId)
                .defaultEnvironmentId(request.getDefaultEnvironmentId())
                .build();

        return TestSuiteResponse.from(repository.save(suite));
    }

    @Transactional
    public TestSuiteResponse update(UUID id, TestSuiteRequest request) {
        TestSuite suite = repository.findByIdWithSteps(id)
                .orElseThrow(() -> new NotFoundException("Test suite not found: " + id));

        UUID collectionId = request.getCollectionId() != null
                ? resolveCollectionId(request.getCollectionId())
                : suite.getCollectionId();

        if (repository.existsByNameAndCollectionIdAndIdNot(request.getName(), collectionId, id)) {
            throw new IllegalArgumentException("Test suite with name '" + request.getName() + "' already exists");
        }

        suite.setName(request.getName());
        suite.setDescription(request.getDescription() != null ? request.getDescription() : "");
        suite.setCollectionId(collectionId);
        suite.setDefaultEnvironmentId(request.getDefaultEnvironmentId());

        return TestSuiteResponse.from(repository.save(suite));
    }

    @Transactional
    public void delete(UUID id) {
        TestSuite suite = repository.findById(id)
                .orElseThrow(() -> new NotFoundException("Test suite not found: " + id));
        suite.setDeletedAt(LocalDateTime.now());
        repository.save(suite);
    }

    @Transactional
    public TestSuiteResponse importSuite(TestSuiteImportRequest request) {
        UUID collectionId = resolveCollectionId(request.getCollectionId());
        if (repository.existsByNameAndCollectionId(request.getName(), collectionId)) {
            throw new IllegalArgumentException("Test suite with name '" + request.getName() + "' already exists");
        }

        TestSuite suite = TestSuite.builder()
                .name(request.getName())
                .description(request.getDescription() != null ? request.getDescription() : "")
                .collectionId(collectionId)
                .build();
        suite = repository.save(suite);
        UUID suiteId = suite.getId();

        if (request.getSteps() == null || request.getSteps().isEmpty()) {
            return TestSuiteResponse.from(suite);
        }

        Map<String, UUID> stepNameToId = new LinkedHashMap<>();
        for (TestSuiteImportRequest.ImportStepDto importStep : request.getSteps()) {
            TestStepRequest stepReq = buildStepRequest(importStep, false);
            TestStepResponse created = stepService.create(suiteId, stepReq);
            stepNameToId.put(created.getName(), created.getId());
        }

        for (TestSuiteImportRequest.ImportStepDto importStep : request.getSteps()) {
            boolean hasDeps = importStep.getDependencies() != null && !importStep.getDependencies().isEmpty();
            boolean hasHandlersWithSideEffect = importStep.getResponseHandlers() != null &&
                    importStep.getResponseHandlers().stream()
                            .anyMatch(h -> h.getSideEffectStepName() != null && !h.getSideEffectStepName().isBlank());

            if (hasDeps || hasHandlersWithSideEffect) {
                UUID stepId = stepNameToId.get(importStep.getName());
                TestStepRequest updateReq = buildStepRequest(importStep, true);

                if (hasDeps) {
                    List<StepDependencyDto> resolvedDeps = new ArrayList<>();
                    for (TestSuiteImportRequest.ImportDependencyDto dep : importStep.getDependencies()) {
                        UUID targetId = stepNameToId.get(dep.getDependsOnStepName());
                        if (targetId == null) {
                            throw new IllegalArgumentException(
                                    "Dependency target step '" + dep.getDependsOnStepName() + "' not found in import data");
                        }
                        resolvedDeps.add(StepDependencyDto.builder()
                                .dependsOnStepId(targetId)
                                .useCache(dep.isUseCache())
                                .reuseManualInput(dep.isReuseManualInput())
                                .build());
                    }
                    updateReq.setDependencies(resolvedDeps);
                }

                if (importStep.getResponseHandlers() != null) {
                    List<StepResponseHandlerDto> resolvedHandlers = new ArrayList<>();
                    for (TestSuiteImportRequest.ImportHandlerDto h : importStep.getResponseHandlers()) {
                        UUID sideEffectId = null;
                        if (h.getSideEffectStepName() != null && !h.getSideEffectStepName().isBlank()) {
                            sideEffectId = stepNameToId.get(h.getSideEffectStepName());
                            if (sideEffectId == null) {
                                throw new IllegalArgumentException(
                                        "Side effect step '" + h.getSideEffectStepName() + "' not found in import data");
                            }
                        }
                        resolvedHandlers.add(StepResponseHandlerDto.builder()
                                .matchCode(h.getMatchCode())
                                .action(h.getAction())
                                .sideEffectStepId(sideEffectId)
                                .retryCount(h.getRetryCount())
                                .retryDelaySeconds(h.getRetryDelaySeconds())
                                .priority(h.getPriority())
                                .build());
                    }
                    updateReq.setResponseHandlers(resolvedHandlers);
                }

                stepService.update(suiteId, stepId, updateReq);
            }
        }

        return TestSuiteResponse.from(repository.findByIdWithSteps(suiteId)
                .orElseThrow(() -> new NotFoundException("Test suite not found: " + suiteId)));
    }

    private UUID resolveCollectionId(UUID collectionId) {
        UUID resolved = collectionId != null ? collectionId : DefaultHierarchyIds.DEFAULT_COLLECTION_ID;
        if (!collectionRepository.existsById(resolved)) {
            throw new NotFoundException("Collection not found: " + resolved);
        }
        return resolved;
    }

    private TestStepRequest buildStepRequest(TestSuiteImportRequest.ImportStepDto importStep, boolean includeHandlers) {
        TestStepRequest req = new TestStepRequest();
        req.setName(importStep.getName());
        req.setMethod(importStep.getMethod() != null ? importStep.getMethod() : com.orchestrator.model.HttpMethod.GET);
        req.setUrl(importStep.getUrl() != null ? importStep.getUrl() : "");
        req.setHeaders(importStep.getHeaders() != null ? importStep.getHeaders() : new ArrayList<>());
        req.setQueryParams(importStep.getQueryParams() != null ? importStep.getQueryParams() : new ArrayList<>());
        req.setBodyType(importStep.getBodyType() != null ? importStep.getBodyType() : "NONE");
        req.setBody(importStep.getBody() != null ? importStep.getBody() : "");
        req.setFormDataFields(importStep.getFormDataFields() != null ? importStep.getFormDataFields() : new ArrayList<>());
        req.setCacheable(importStep.isCacheable());
        req.setCacheTtlSeconds(importStep.getCacheTtlSeconds());
        req.setDependencyOnly(importStep.isDependencyOnly());
        req.setDisabledDefaultHeaders(importStep.getDisabledDefaultHeaders() != null ? importStep.getDisabledDefaultHeaders() : new ArrayList<>());
        req.setOauthMode(importStep.getOauthMode() != null
                ? importStep.getOauthMode()
                : com.orchestrator.model.enums.OAuthMode.INHERIT);
        req.setGroupName(importStep.getGroupName());
        req.setExtractVariables(importStep.getExtractVariables() != null ? importStep.getExtractVariables() : new ArrayList<>());
        req.setVerifications(importStep.getVerifications() != null ? importStep.getVerifications() : new ArrayList<>());
        req.setResponseValidations(importStep.getResponseValidations() != null ? importStep.getResponseValidations() : new ArrayList<>());

        req.setDependencies(new ArrayList<>());

        if (includeHandlers) {
            if (importStep.getResponseHandlers() != null) {
                List<StepResponseHandlerDto> handlers = new ArrayList<>();
                for (TestSuiteImportRequest.ImportHandlerDto h : importStep.getResponseHandlers()) {
                    handlers.add(StepResponseHandlerDto.builder()
                            .matchCode(h.getMatchCode())
                            .action(h.getAction())
                            .retryCount(h.getRetryCount())
                            .retryDelaySeconds(h.getRetryDelaySeconds())
                            .priority(h.getPriority())
                            .build());
                }
                req.setResponseHandlers(handlers);
            }
        } else {
            if (importStep.getResponseHandlers() != null) {
                boolean anySideEffect = importStep.getResponseHandlers().stream()
                        .anyMatch(h -> h.getSideEffectStepName() != null && !h.getSideEffectStepName().isBlank());
                if (!anySideEffect) {
                    List<StepResponseHandlerDto> handlers = new ArrayList<>();
                    for (TestSuiteImportRequest.ImportHandlerDto h : importStep.getResponseHandlers()) {
                        handlers.add(StepResponseHandlerDto.builder()
                                .matchCode(h.getMatchCode())
                                .action(h.getAction())
                                .retryCount(h.getRetryCount())
                                .retryDelaySeconds(h.getRetryDelaySeconds())
                                .priority(h.getPriority())
                                .build());
                    }
                    req.setResponseHandlers(handlers);
                } else {
                    req.setResponseHandlers(new ArrayList<>());
                }
            } else {
                req.setResponseHandlers(new ArrayList<>());
            }
        }

        return req;
    }
}
