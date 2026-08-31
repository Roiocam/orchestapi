package com.orchestrator.service;

import com.orchestrator.connector.ConnectorFactory;
import com.orchestrator.dto.EnvironmentOAuthRequest;
import com.orchestrator.dto.EnvironmentResponse;
import com.orchestrator.dto.EnvironmentRequest;
import com.orchestrator.model.Environment;
import com.orchestrator.model.EnvironmentOAuthConfig;
import com.orchestrator.repository.EnvironmentFileRepository;
import com.orchestrator.repository.EnvironmentOAuthConfigRepository;
import com.orchestrator.repository.EnvironmentRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class EnvironmentOAuthServiceTest {

    @Mock
    private EnvironmentRepository environmentRepository;
    @Mock
    private EnvironmentFileRepository fileRepository;
    @Mock
    private ConnectorFactory connectorFactory;
    @Mock
    private EnvironmentOAuthConfigRepository oauthRepository;
    @Mock
    private org.springframework.core.env.Environment springEnvironment;

    private EnvironmentService service;

    @BeforeEach
    void setUp() {
        service = new EnvironmentService(
                environmentRepository,
                fileRepository,
                connectorFactory,
                oauthRepository,
                springEnvironment);
        lenient().when(springEnvironment.acceptsProfiles(org.springframework.core.env.Profiles.of("prod")))
                .thenReturn(false);
    }

    @Test
    void createPersistsEnabledOAuthConfigurationButReturnsMaskedSecret() {
        UUID environmentId = UUID.randomUUID();
        when(environmentRepository.existsByName(any())).thenReturn(false);
        doAnswer(invocation -> {
            Environment env = invocation.getArgument(0);
            env.setId(environmentId);
            if (env.getOauthConfig() != null) {
                env.getOauthConfig().setEnvironmentId(environmentId);
            }
            return env;
        }).when(environmentRepository).save(any(Environment.class));

        EnvironmentResponse response = service.create(requestWithOAuth(false));

        ArgumentCaptor<Environment> saved = ArgumentCaptor.forClass(Environment.class);
        verify(environmentRepository).save(saved.capture());
        EnvironmentOAuthConfig config = saved.getValue().getOauthConfig();
        assertThat(config).isNotNull();
        assertThat(config.isEnabled()).isTrue();
        assertThat(config.getClientSecret()).isEqualTo("client-secret-value");
        assertThat(response.getOauth().getClientSecret()).isEqualTo(EnvironmentOAuthConfig.MASKED_SECRET);
        assertThat(response.getOauth().isClientSecretConfigured()).isTrue();
        assertThat(response.getOauth().getClientSecret()).doesNotContain("client-secret-value");
    }

    @Test
    void updateWithMaskedSecretPreservesStoredSecretAndIncrementsRevision() {
        UUID environmentId = UUID.randomUUID();
        EnvironmentOAuthConfig config = enabledConfig(environmentId);
        config.setRevision(4);
        Environment env = environment(environmentId, config);
        when(environmentRepository.findByIdWithDetails(environmentId)).thenReturn(Optional.of(env));
        when(environmentRepository.existsByNameAndIdNot(any(), any())).thenReturn(false);
        when(environmentRepository.findByIdWithConnectors(environmentId)).thenReturn(Optional.of(env));
        when(environmentRepository.save(any(Environment.class))).thenAnswer(invocation -> invocation.getArgument(0));

        EnvironmentOAuthRequest oauth = requestWithOAuth(false).getOauth();
        oauth.setClientSecret(EnvironmentOAuthConfig.MASKED_SECRET);
        oauth.setTokenEndpoint("https://idp.example.test/oauth/token-v2");
        EnvironmentResponse response = service.update(environmentId, request(oauth));

        assertThat(config.getClientSecret()).isEqualTo("client-secret-value");
        assertThat(config.getTokenEndpoint()).endsWith("token-v2");
        assertThat(config.getRevision()).isEqualTo(5);
        assertThat(response.getOauth().getClientSecret()).isEqualTo(EnvironmentOAuthConfig.MASKED_SECRET);
    }

    @Test
    void updateRequiresExplicitClearToRemoveStoredSecret() {
        UUID environmentId = UUID.randomUUID();
        EnvironmentOAuthConfig config = enabledConfig(environmentId);
        Environment env = environment(environmentId, config);
        when(environmentRepository.findByIdWithDetails(environmentId)).thenReturn(Optional.of(env));
        when(environmentRepository.existsByNameAndIdNot(any(), any())).thenReturn(false);
        when(environmentRepository.findByIdWithConnectors(environmentId)).thenReturn(Optional.of(env));
        when(environmentRepository.save(any(Environment.class))).thenAnswer(invocation -> invocation.getArgument(0));

        EnvironmentOAuthRequest oauth = requestWithOAuth(false).getOauth();
        oauth.setClearClientSecret(true);
        oauth.setClientSecret(null);
        oauth.setEnabled(false);
        EnvironmentResponse response = service.update(environmentId, request(oauth));

        assertThat(config.getClientSecret()).isEmpty();
        assertThat(response.getOauth().isClientSecretConfigured()).isFalse();
    }

    @Test
    void clearAndReplacementSecretCannotBeSubmittedTogether() {
        UUID environmentId = UUID.randomUUID();
        EnvironmentOAuthConfig config = enabledConfig(environmentId);
        Environment env = environment(environmentId, config);
        when(environmentRepository.findByIdWithDetails(environmentId)).thenReturn(Optional.of(env));
        when(environmentRepository.existsByNameAndIdNot(any(), any())).thenReturn(false);
        when(environmentRepository.findByIdWithConnectors(environmentId)).thenReturn(Optional.of(env));

        EnvironmentOAuthRequest oauth = requestWithOAuth(false).getOauth();
        oauth.setClearClientSecret(true);
        oauth.setClientSecret("new-secret");

        assertThatThrownBy(() -> service.update(environmentId, request(oauth)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("clearClientSecret");
    }

    private EnvironmentRequest requestWithOAuth(boolean clear) {
        return request(EnvironmentOAuthRequest.builder()
                .enabled(true)
                .tokenEndpoint("https://idp.example.test/oauth/token")
                .clientId("service-client")
                .clientSecret("client-secret-value")
                .scopes("orders.read")
                .audience("orders-api")
                .clientAuthMethod(EnvironmentOAuthConfig.CLIENT_SECRET_BASIC)
                .refreshSkewSeconds(60L)
                .requestTimeoutMs(10_000L)
                .clearClientSecret(clear)
                .build());
    }

    private EnvironmentRequest request(EnvironmentOAuthRequest oauth) {
        return EnvironmentRequest.builder()
                .name("orders")
                .baseUrl("https://api.example.test")
                .oauth(oauth)
                .build();
    }

    private Environment environment(UUID id, EnvironmentOAuthConfig config) {
        Environment env = Environment.builder()
                .id(id)
                .name("orders")
                .baseUrl("https://api.example.test")
                .oauthConfig(config)
                .build();
        config.setEnvironment(env);
        return env;
    }

    private EnvironmentOAuthConfig enabledConfig(UUID environmentId) {
        EnvironmentOAuthConfig config = EnvironmentOAuthConfig.disabled(environmentId);
        config.setEnabled(true);
        config.setTokenEndpoint("https://idp.example.test/oauth/token");
        config.setClientId("service-client");
        config.setClientSecret("client-secret-value");
        config.setScopes("orders.read");
        config.setAudience("orders-api");
        return config;
    }
}
