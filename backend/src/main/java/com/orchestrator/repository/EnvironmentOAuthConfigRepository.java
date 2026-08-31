package com.orchestrator.repository;

import com.orchestrator.model.EnvironmentOAuthConfig;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface EnvironmentOAuthConfigRepository extends JpaRepository<EnvironmentOAuthConfig, UUID> {
}
