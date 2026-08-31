package com.orchestrator.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.orchestrator.connector.ConnectorFactory;
import com.orchestrator.connector.InfraConnector;
import com.orchestrator.dto.*;
import com.orchestrator.exception.NotFoundException;
import com.orchestrator.model.Environment;
import com.orchestrator.model.EnvironmentConnector;
import com.orchestrator.model.EnvironmentHeader;
import com.orchestrator.model.EnvironmentVariable;
import com.orchestrator.model.EnvironmentOAuthConfig;
import com.orchestrator.model.HeaderValueType;
import com.orchestrator.model.enums.ConnectorType;
import com.orchestrator.model.EnvironmentFile;
import com.orchestrator.repository.EnvironmentFileRepository;
import com.orchestrator.repository.EnvironmentOAuthConfigRepository;
import com.orchestrator.repository.EnvironmentRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class EnvironmentService {

    private static final long MAX_FILE_SIZE = 50L * 1024 * 1024; // 50MB

    private final EnvironmentRepository repository;
    private final EnvironmentFileRepository fileRepository;
    private final ConnectorFactory connectorFactory;
    private final EnvironmentOAuthConfigRepository oauthConfigRepository;
    private final org.springframework.core.env.Environment springEnvironment;

    @Transactional(readOnly = true)
    public PageResponse<EnvironmentResponse> findAllPaged(String name, String baseUrl, Pageable pageable) {
        Specification<Environment> spec = Specification.where(null);

        if (name != null && !name.isBlank()) {
            spec = spec.and((root, query, cb) ->
                    cb.like(cb.lower(root.get("name")), "%" + name.toLowerCase() + "%"));
        }
        if (baseUrl != null && !baseUrl.isBlank()) {
            spec = spec.and((root, query, cb) ->
                    cb.like(cb.lower(root.get("baseUrl")), "%" + baseUrl.toLowerCase() + "%"));
        }

        // Step 1: paginated query for IDs only
        Page<Environment> idPage = repository.findAll(spec, pageable);
        List<UUID> ids = idPage.getContent().stream().map(Environment::getId).toList();

        if (ids.isEmpty()) {
            return PageResponse.from(idPage, env -> EnvironmentResponse.from(env, true));
        }

        // Step 2: fetch full details for current page IDs (separate queries to avoid Cartesian product)
        List<Environment> withVars = repository.findByIdsWithVariables(ids);
        repository.findByIdsWithHeaders(ids); // populates Hibernate L1 cache
        repository.findByIdsWithConnectors(ids); // populates Hibernate L1 cache for connectors
        repository.findByIdsWithOAuthConfigs(ids); // populates Hibernate L1 cache for OAuth config

        // Preserve page order
        Map<UUID, Environment> byId = withVars.stream()
                .collect(Collectors.toMap(Environment::getId, Function.identity()));
        List<Environment> ordered = ids.stream().map(byId::get).toList();

        Page<Environment> fullPage = new PageImpl<>(ordered, pageable, idPage.getTotalElements());
        return PageResponse.from(fullPage, env -> EnvironmentResponse.from(env, true));
    }

    @Transactional(readOnly = true)
    public EnvironmentResponse findById(UUID id) {
        Environment env = repository.findByIdWithDetails(id)
                .orElseThrow(() -> new NotFoundException("Environment not found: " + id));
        repository.findByIdWithConnectors(id); // populates L1 cache for connectors
        return EnvironmentResponse.from(env, true);
    }

    @Transactional
    public EnvironmentResponse create(EnvironmentRequest request) {
        if (repository.existsByName(request.getName())) {
            throw new IllegalArgumentException("Environment with name '" + request.getName() + "' already exists");
        }

        validateUniqueness(request);

        Environment env = Environment.builder()
                .name(request.getName())
                .baseUrl(request.getBaseUrl())
                .build();

        applyVariables(env, request);
        applyHeaders(env, request);
        applyConnectors(env, request, Set.of());
        applyOAuthOnCreate(env, request.getOauth());

        return EnvironmentResponse.from(repository.save(env), true);
    }

    @Transactional
    public EnvironmentResponse update(UUID id, EnvironmentRequest request) {
        Environment env = repository.findByIdWithDetails(id)
                .orElseThrow(() -> new NotFoundException("Environment not found: " + id));
        repository.findByIdWithConnectors(id); // load connectors into L1 cache

        if (repository.existsByNameAndIdNot(request.getName(), id)) {
            throw new IllegalArgumentException("Environment with name '" + request.getName() + "' already exists");
        }

        validateUniqueness(request);

        env.setName(request.getName());
        env.setBaseUrl(request.getBaseUrl());

        // Preserve secret values that come back masked
        Set<EnvironmentVariable> existingVars = new LinkedHashSet<>(env.getVariables());

        env.getVariables().clear();
        applyVariables(env, request, existingVars);

        env.getHeaders().clear();
        applyHeaders(env, request);

        Set<EnvironmentConnector> existingConnectors = new LinkedHashSet<>(env.getConnectors());
        env.getConnectors().clear();
        repository.saveAndFlush(env); // flush deletes before re-insert to avoid unique constraint violation
        applyConnectors(env, request, existingConnectors);
        applyOAuthOnUpdate(env, request.getOauth());

        return EnvironmentResponse.from(repository.save(env), true);
    }

    @Transactional
    public void delete(UUID id) {
        Environment env = repository.findById(id)
                .orElseThrow(() -> new NotFoundException("Environment not found: " + id));
        oauthConfigRepository.findById(id).ifPresent(oauthConfigRepository::delete);
        env.setDeletedAt(LocalDateTime.now());
        repository.save(env);
    }

    private void applyOAuthOnCreate(Environment env, EnvironmentOAuthRequest request) {
        EnvironmentOAuthConfig config = EnvironmentOAuthConfig.disabled(env.getId());
        config.setEnvironment(env);
        if (request != null) {
            applyOAuthFields(config, request, false);
        }
        validateOAuth(config);
        env.setOauthConfig(config);
    }

    private void applyOAuthOnUpdate(Environment env, EnvironmentOAuthRequest request) {
        EnvironmentOAuthConfig config = env.getOauthConfig();
        if (config == null) {
            config = EnvironmentOAuthConfig.disabled(env.getId());
            config.setEnvironment(env);
            env.setOauthConfig(config);
        }
        if (request == null) {
            return;
        }

        EnvironmentOAuthSnapshotBeforeUpdate before = EnvironmentOAuthSnapshotBeforeUpdate.from(config);
        applyOAuthFields(config, request, true);
        validateOAuth(config);
        if (!before.matches(config)) {
            config.setRevision(Math.max(1, before.revision()) + 1);
        }
    }

    private void applyOAuthFields(
            EnvironmentOAuthConfig config, EnvironmentOAuthRequest request, boolean preserveExistingValues) {
        if (request.isClearClientSecret()
                && hasNewClientSecret(request.getClientSecret())) {
            throw new IllegalArgumentException("clearClientSecret cannot be combined with a new clientSecret");
        }

        if (request.getTokenEndpoint() != null || !preserveExistingValues) {
            config.setTokenEndpoint(valueOrEmpty(request.getTokenEndpoint()));
        }
        if (request.getClientId() != null || !preserveExistingValues) {
            config.setClientId(valueOrEmpty(request.getClientId()));
        }
        if (request.getScopes() != null || !preserveExistingValues) {
            config.setScopes(valueOrEmpty(request.getScopes()));
        }
        if (request.getAudience() != null || !preserveExistingValues) {
            config.setAudience(valueOrEmpty(request.getAudience()));
        }
        if (request.getClientAuthMethod() != null || !preserveExistingValues) {
            config.setClientAuthMethod(
                    request.getClientAuthMethod() == null || request.getClientAuthMethod().isBlank()
                            ? EnvironmentOAuthConfig.CLIENT_SECRET_BASIC
                            : request.getClientAuthMethod().trim());
        }
        if (request.getRefreshSkewSeconds() != null || !preserveExistingValues) {
            config.setRefreshSkewSeconds(request.getRefreshSkewSeconds() == null
                    ? 60 : request.getRefreshSkewSeconds());
        }
        if (request.getRequestTimeoutMs() != null || !preserveExistingValues) {
            config.setRequestTimeoutMs(request.getRequestTimeoutMs() == null
                    ? 10_000 : request.getRequestTimeoutMs());
        }
        config.setEnabled(request.isEnabled());

        if (request.isClearClientSecret()) {
            config.setClientSecret("");
        } else if (!preserveExistingValues) {
            config.setClientSecret(valueOrEmpty(request.getClientSecret()));
        } else if (hasNewClientSecret(request.getClientSecret())) {
            config.setClientSecret(request.getClientSecret());
        }
    }

    private void validateOAuth(EnvironmentOAuthConfig config) {
        config.validate(springEnvironment.acceptsProfiles(Profiles.of("prod")));
    }

    private boolean hasNewClientSecret(String value) {
        return value != null && !value.isBlank() && !EnvironmentOAuthConfig.MASKED_SECRET.equals(value);
    }

    private String valueOrEmpty(String value) {
        return value == null ? "" : value.trim();
    }

    private record EnvironmentOAuthSnapshotBeforeUpdate(
            boolean enabled,
            String tokenEndpoint,
            String clientId,
            String clientSecret,
            String scopes,
            String audience,
            String clientAuthMethod,
            long refreshSkewSeconds,
            long requestTimeoutMs,
            long revision) {

        static EnvironmentOAuthSnapshotBeforeUpdate from(EnvironmentOAuthConfig config) {
            return new EnvironmentOAuthSnapshotBeforeUpdate(
                    config.isEnabled(),
                    config.getTokenEndpoint(),
                    config.getClientId(),
                    config.getClientSecret(),
                    config.getScopes(),
                    config.getAudience(),
                    config.getClientAuthMethod(),
                    config.getRefreshSkewSeconds(),
                    config.getRequestTimeoutMs(),
                    config.getRevision());
        }

        boolean matches(EnvironmentOAuthConfig config) {
            return enabled == config.isEnabled()
                    && Objects.equals(tokenEndpoint, config.getTokenEndpoint())
                    && Objects.equals(clientId, config.getClientId())
                    && Objects.equals(clientSecret, config.getClientSecret())
                    && Objects.equals(scopes, config.getScopes())
                    && Objects.equals(audience, config.getAudience())
                    && Objects.equals(clientAuthMethod, config.getClientAuthMethod())
                    && refreshSkewSeconds == config.getRefreshSkewSeconds()
                    && requestTimeoutMs == config.getRequestTimeoutMs();
        }
    }

    @Transactional(readOnly = true)
    public TestConnectionResponse testConnection(TestConnectionRequest request) {
        long start = System.currentTimeMillis();
        try {
            Map<String, String> config = new LinkedHashMap<>(request.getConfig());

            // Resolve masked passwords if environmentId provided
            if (request.getEnvironmentId() != null) {
                resolveTestConnectionPasswords(config, request.getEnvironmentId(), request.getConnectorName());
            }

            Map<String, Object> configObj = new LinkedHashMap<>(config);

            InfraConnector connector = connectorFactory.getConnector(request.getType());
            String testQuery = getTestQuery(request.getType());
            connector.execute(request.getType(), configObj, testQuery, 10);

            return TestConnectionResponse.builder()
                    .success(true)
                    .message("Connection successful")
                    .durationMs(System.currentTimeMillis() - start)
                    .build();
        } catch (Exception e) {
            return TestConnectionResponse.builder()
                    .success(false)
                    .message(e.getMessage())
                    .durationMs(System.currentTimeMillis() - start)
                    .build();
        }
    }

    private String getTestQuery(ConnectorType type) {
        return switch (type) {
            case MYSQL, POSTGRES, SQLSERVER -> "SELECT 1";
            case ORACLE -> "SELECT 1 FROM DUAL";
            case REDIS -> "PING";
            case ELASTICSEARCH -> "GET /";
            case KAFKA, RABBITMQ, MONGODB -> "";
        };
    }

    private void resolveTestConnectionPasswords(Map<String, String> config, UUID environmentId, String connectorName) {
        ObjectMapper objectMapper = new ObjectMapper();
        Environment env = repository.findByIdWithConnectors(environmentId).orElse(null);
        if (env == null) return;

        config.replaceAll((key, value) -> {
            if (key.toLowerCase().contains("password") && "••••••••".equals(value)) {
                Optional<String> resolved = env.getConnectors().stream()
                        .filter(ec -> connectorName != null && ec.getName().equals(connectorName))
                        .findFirst()
                        .flatMap(ec -> resolvePasswordFromConfig(ec.getConfig(), key, objectMapper));
                return resolved.orElse(value);
            }
            return value;
        });
    }

    private void validateUniqueness(EnvironmentRequest request) {
        List<? extends Object> vars = request.getVariables();
        if (vars != null && !vars.isEmpty()) {
            Set<String> varKeys = new HashSet<>();
            List<String> dupVars = request.getVariables().stream()
                    .map(v -> v.getKey() != null ? v.getKey().trim() : "")
                    .filter(k -> !k.isEmpty() && !varKeys.add(k))
                    .distinct()
                    .toList();
            if (!dupVars.isEmpty()) {
                throw new IllegalArgumentException("Duplicate variable key(s): " + String.join(", ", dupVars));
            }
        }

        List<? extends Object> hdrs = request.getHeaders();
        if (hdrs != null && !hdrs.isEmpty()) {
            Set<String> hdrKeys = new HashSet<>();
            List<String> dupHdrs = request.getHeaders().stream()
                    .map(h -> h.getHeaderKey() != null ? h.getHeaderKey().trim() : "")
                    .filter(k -> !k.isEmpty() && !hdrKeys.add(k))
                    .distinct()
                    .toList();
            if (!dupHdrs.isEmpty()) {
                throw new IllegalArgumentException("Duplicate header key(s): " + String.join(", ", dupHdrs));
            }
        }

        List<? extends Object> conns = request.getConnectors();
        if (conns != null && !conns.isEmpty()) {
            Set<String> connNames = new HashSet<>();
            List<String> dupConns = request.getConnectors().stream()
                    .map(c -> c.getName() != null ? c.getName().trim() : "")
                    .filter(n -> !n.isEmpty() && !connNames.add(n))
                    .distinct()
                    .toList();
            if (!dupConns.isEmpty()) {
                throw new IllegalArgumentException("Duplicate connector name(s): " + String.join(", ", dupConns));
            }
        }
    }

    private void applyVariables(Environment env, EnvironmentRequest request) {
        applyVariables(env, request, Set.of());
    }

    private void applyVariables(Environment env, EnvironmentRequest request, Set<EnvironmentVariable> existingVars) {
        if (request.getVariables() == null) return;
        AtomicInteger order = new AtomicInteger(0);
        request.getVariables().forEach(dto -> {
            String value = dto.getValue();
            // If secret value is masked, find the original by ID first, then by key
            if (dto.isSecret() && "••••••••".equals(value)) {
                Optional<String> resolved = Optional.empty();
                // Try to match by ID first (handles key renames)
                if (dto.getId() != null) {
                    resolved = existingVars.stream()
                            .filter(ev -> ev.getId().equals(dto.getId()) && ev.isSecret())
                            .map(EnvironmentVariable::getValue)
                            .findFirst();
                }
                // Fallback to key match
                if (resolved.isEmpty()) {
                    resolved = existingVars.stream()
                            .filter(ev -> ev.getKey().equals(dto.getKey()) && ev.isSecret())
                            .map(EnvironmentVariable::getValue)
                            .findFirst();
                }
                value = resolved.orElseThrow(() ->
                        new IllegalArgumentException("Cannot resolve masked secret for key '" + dto.getKey() + "'. Please provide the actual value."));
            }

            HeaderValueType valueType = HeaderValueType.STATIC;
            if (dto.getValueType() != null) {
                try { valueType = HeaderValueType.valueOf(dto.getValueType()); } catch (IllegalArgumentException ignored) {}
            }

            EnvironmentVariable var = EnvironmentVariable.builder()
                    .environment(env)
                    .key(dto.getKey())
                    .value(value)
                    .valueType(valueType)
                    .secret(dto.isSecret())
                    .sortOrder(order.getAndIncrement())
                    .build();
            env.getVariables().add(var);
        });
    }

    private void applyHeaders(Environment env, EnvironmentRequest request) {
        if (request.getHeaders() == null) return;
        AtomicInteger order = new AtomicInteger(0);
        request.getHeaders().forEach(dto -> {
            EnvironmentHeader header = EnvironmentHeader.builder()
                    .environment(env)
                    .headerKey(dto.getHeaderKey())
                    .valueType(dto.getValueType())
                    .headerValue(dto.getHeaderValue())
                    .sortOrder(order.getAndIncrement())
                    .build();
            env.getHeaders().add(header);
        });
    }

    private void applyConnectors(Environment env, EnvironmentRequest request, Set<EnvironmentConnector> existingConnectors) {
        if (request.getConnectors() == null) return;
        AtomicInteger order = new AtomicInteger(0);
        ObjectMapper objectMapper = new ObjectMapper();
        request.getConnectors().forEach(dto -> {
            Map<String, String> config = new LinkedHashMap<>(dto.getConfig() != null ? dto.getConfig() : Map.of());

            // Resolve masked passwords from existing connectors
            config.replaceAll((key, value) -> {
                if (key.toLowerCase().contains("password") && "••••••••".equals(value)) {
                    // Find existing connector by ID first, then by name
                    Optional<String> resolved = Optional.empty();
                    if (dto.getId() != null) {
                        resolved = existingConnectors.stream()
                                .filter(ec -> ec.getId().equals(dto.getId()))
                                .findFirst()
                                .flatMap(ec -> resolvePasswordFromConfig(ec.getConfig(), key, objectMapper));
                    }
                    if (resolved.isEmpty()) {
                        resolved = existingConnectors.stream()
                                .filter(ec -> ec.getName().equals(dto.getName()))
                                .findFirst()
                                .flatMap(ec -> resolvePasswordFromConfig(ec.getConfig(), key, objectMapper));
                    }
                    return resolved.orElseThrow(() ->
                            new IllegalArgumentException("Cannot resolve masked password for connector '" + dto.getName() + "', field '" + key + "'. Please provide the actual value."));
                }
                return value;
            });

            String configJson;
            try {
                configJson = objectMapper.writeValueAsString(config);
            } catch (Exception e) {
                configJson = "{}";
            }

            EnvironmentConnector connector = EnvironmentConnector.builder()
                    .environment(env)
                    .name(dto.getName())
                    .type(dto.getType())
                    .config(configJson)
                    .sortOrder(order.getAndIncrement())
                    .build();
            env.getConnectors().add(connector);
        });
    }

    private Optional<String> resolvePasswordFromConfig(String configJson, String key, ObjectMapper objectMapper) {
        try {
            Map<String, String> existingConfig = objectMapper.readValue(configJson,
                    new TypeReference<Map<String, String>>() {});
            String val = existingConfig.get(key);
            return val != null ? Optional.of(val) : Optional.empty();
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    // ── File management ─────────────────────────────────────────────────

    @Transactional
    public EnvironmentFileResponse uploadFile(UUID environmentId, String fileKey, MultipartFile file) {
        if (!repository.existsById(environmentId)) {
            throw new NotFoundException("Environment not found: " + environmentId);
        }
        if (file.getSize() > MAX_FILE_SIZE) {
            throw new IllegalArgumentException("File size exceeds 50MB limit");
        }
        if (fileKey == null || fileKey.isBlank()) {
            throw new IllegalArgumentException("File key is required");
        }

        byte[] data;
        try {
            data = file.getBytes();
        } catch (IOException e) {
            throw new IllegalArgumentException("Failed to read uploaded file: " + e.getMessage());
        }

        // Upsert: replace if same key exists
        Optional<EnvironmentFile> existing = fileRepository.findByEnvironmentIdAndFileKey(environmentId, fileKey.trim());
        EnvironmentFile envFile;
        if (existing.isPresent()) {
            envFile = existing.get();
            envFile.setFileName(file.getOriginalFilename());
            envFile.setContentType(file.getContentType());
            envFile.setFileSize(file.getSize());
            envFile.setFileData(data);
        } else {
            envFile = EnvironmentFile.builder()
                    .environmentId(environmentId)
                    .fileKey(fileKey.trim())
                    .fileName(file.getOriginalFilename())
                    .contentType(file.getContentType())
                    .fileSize(file.getSize())
                    .fileData(data)
                    .build();
        }

        return EnvironmentFileResponse.from(fileRepository.save(envFile));
    }

    @Transactional(readOnly = true)
    public List<EnvironmentFileResponse> listFiles(UUID environmentId) {
        if (!repository.existsById(environmentId)) {
            throw new NotFoundException("Environment not found: " + environmentId);
        }
        return fileRepository.findByEnvironmentId(environmentId).stream()
                .map(EnvironmentFileResponse::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public EnvironmentFile downloadFile(UUID environmentId, UUID fileId) {
        return fileRepository.findByIdAndEnvironmentId(fileId, environmentId)
                .orElseThrow(() -> new NotFoundException("File not found: " + fileId));
    }

    @Transactional
    public void deleteFile(UUID environmentId, UUID fileId) {
        EnvironmentFile file = fileRepository.findByIdAndEnvironmentId(fileId, environmentId)
                .orElseThrow(() -> new NotFoundException("File not found: " + fileId));
        fileRepository.delete(file);
    }
}
