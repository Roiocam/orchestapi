package com.orchestrator.repository;

import com.orchestrator.model.ApiCollection;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ApiCollectionRepository extends JpaRepository<ApiCollection, UUID> {

    List<ApiCollection> findByProjectIdOrderByNameAsc(UUID projectId);

    List<ApiCollection> findAllByOrderByNameAsc();

    long countByProjectId(UUID projectId);

    boolean existsByProjectIdAndName(UUID projectId, String name);

    boolean existsByProjectIdAndNameAndIdNot(UUID projectId, String name, UUID id);
}
