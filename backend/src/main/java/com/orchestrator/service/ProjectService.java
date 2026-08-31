package com.orchestrator.service;

import com.orchestrator.dto.ProjectRequest;
import com.orchestrator.dto.ProjectResponse;
import com.orchestrator.exception.NotFoundException;
import com.orchestrator.model.DefaultHierarchyIds;
import com.orchestrator.model.Project;
import com.orchestrator.repository.ApiCollectionRepository;
import com.orchestrator.repository.ProjectRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ProjectService {

    private final ProjectRepository repository;
    private final ApiCollectionRepository collectionRepository;

    @Transactional(readOnly = true)
    public List<ProjectResponse> findAll() {
        return repository.findAllByOrderByNameAsc().stream()
                .map(p -> ProjectResponse.from(p, (int) collectionRepository.countByProjectId(p.getId())))
                .toList();
    }

    @Transactional(readOnly = true)
    public ProjectResponse findById(UUID id) {
        Project project = repository.findById(id)
                .orElseThrow(() -> new NotFoundException("Project not found: " + id));
        return ProjectResponse.from(project, (int) collectionRepository.countByProjectId(id));
    }

    @Transactional
    public ProjectResponse create(ProjectRequest request) {
        if (repository.existsByName(request.getName())) {
            throw new IllegalArgumentException("Project with name '" + request.getName() + "' already exists");
        }
        Project project = Project.builder()
                .name(request.getName())
                .description(request.getDescription() != null ? request.getDescription() : "")
                .build();
        project = repository.save(project);
        return ProjectResponse.from(project, 0);
    }

    @Transactional
    public ProjectResponse update(UUID id, ProjectRequest request) {
        Project project = repository.findById(id)
                .orElseThrow(() -> new NotFoundException("Project not found: " + id));
        if (repository.existsByNameAndIdNot(request.getName(), id)) {
            throw new IllegalArgumentException("Project with name '" + request.getName() + "' already exists");
        }
        project.setName(request.getName());
        project.setDescription(request.getDescription() != null ? request.getDescription() : "");
        project = repository.save(project);
        return ProjectResponse.from(project, (int) collectionRepository.countByProjectId(id));
    }

    @Transactional
    public void delete(UUID id) {
        if (DefaultHierarchyIds.DEFAULT_PROJECT_ID.equals(id)) {
            throw new IllegalArgumentException("Default project cannot be deleted");
        }
        Project project = repository.findById(id)
                .orElseThrow(() -> new NotFoundException("Project not found: " + id));
        if (collectionRepository.countByProjectId(id) > 0) {
            throw new IllegalArgumentException("Cannot delete project that still has collections");
        }
        project.setDeletedAt(LocalDateTime.now());
        repository.save(project);
    }
}
