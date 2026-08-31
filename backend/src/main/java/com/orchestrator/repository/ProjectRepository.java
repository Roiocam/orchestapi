package com.orchestrator.repository;

import com.orchestrator.model.Project;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ProjectRepository extends JpaRepository<Project, UUID> {

    List<Project> findAllByOrderByNameAsc();

    boolean existsByName(String name);

    boolean existsByNameAndIdNot(String name, UUID id);
}
