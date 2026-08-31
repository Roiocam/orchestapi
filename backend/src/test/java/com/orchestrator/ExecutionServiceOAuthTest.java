package com.orchestrator;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.orchestrator.config.OAuthProperties;
import com.orchestrator.dto.StepExecutionResult;
import com.orchestrator.dto.SuiteExecutionResult;
import com.orchestrator.model.HttpMethod;
import com.orchestrator.model.TestStep;
import com.orchestrator.model.TestSuite;
import com.orchestrator.model.enums.BodyType;
import com.orchestrator.model.enums.OAuthMode;
import com.orchestrator.repository.EnvironmentFileRepository;
import com.orchestrator.repository.EnvironmentRepository;
import com.orchestrator.repository.TestStepRepository;
import com.orchestrator.repository.TestSuiteRepository;
import com.orchestrator.oauth.DefaultOAuthRequestAuthorizer;
import com.orchestrator.oauth.OAuthTokenErrorCode;
import com.orchestrator.oauth.OAuthTokenException;
import com.orchestrator.oauth.OAuthTokenProvider;
import com.orchestrator.oauth.RequestHeaderRedactor;
import com.orchestrator.service.ExecutionService;
import com.orchestrator.service.ResponseValidationService;
import com.orchestrator.service.VerificationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class ExecutionServiceOAuthTest {

    private UUID suiteId;
    private UUID stepId;
    private TestSuite suite;
    private TestStep step;
    private TestStepRepository stepRepo;
    private TestSuiteRepository suiteRepo;
    private EnvironmentRepository envRepo;
    private RestTemplate restTemplate;
    private OAuthTokenProvider provider;
    private OAuthProperties properties;
    private ExecutionService executionService;

    @BeforeEach
    void setUp() {
        suiteId = UUID.randomUUID();
        stepId = UUID.randomUUID();
        suite = TestSuite.builder().id(suiteId).name("oauth-suite").description("").build();
        step = baseStep();
        step.setSuite(suite);

        stepRepo = mock(TestStepRepository.class);
        suiteRepo = mock(TestSuiteRepository.class);
        envRepo = mock(EnvironmentRepository.class);
        EnvironmentFileRepository fileRepo = mock(EnvironmentFileRepository.class);
        RestTemplate targetRestTemplate = mock(RestTemplate.class);
        restTemplate = targetRestTemplate;
        VerificationService verificationService = mock(VerificationService.class);
        ResponseValidationService responseValidationService = mock(ResponseValidationService.class);
        provider = mock(OAuthTokenProvider.class);
        properties = new OAuthProperties();
        properties.setEnabled(true);
        DefaultOAuthRequestAuthorizer authorizer = new DefaultOAuthRequestAuthorizer(properties, provider);

        when(suiteRepo.findById(suiteId)).thenReturn(Optional.of(suite));
        when(stepRepo.findBySuiteIdWithDetails(suiteId)).thenReturn(List.of(step));
        when(stepRepo.findBySuiteIdWithVerifications(suiteId)).thenReturn(List.of(step));
        when(stepRepo.findBySuiteIdWithResponseValidations(suiteId)).thenReturn(List.of(step));
        doReturn(Collections.emptyMap()).when(verificationService)
                .startPreListeners(any(), any(), any(), any());
        when(targetRestTemplate.exchange(
                any(URI.class), any(), any(HttpEntity.class), eq(String.class)))
                .thenReturn(ResponseEntity.ok("{}"));

        executionService = new ExecutionService(
                stepRepo,
                suiteRepo,
                envRepo,
                fileRepo,
                new ObjectMapper(),
                targetRestTemplate,
                verificationService,
                responseValidationService,
                authorizer,
                new RequestHeaderRedactor());
    }

    @Test
    void sendsAutomaticBearerTokenToTargetAndRedactsResultHeaders() {
        when(provider.getToken()).thenReturn(
                new com.orchestrator.oauth.OAuthAccessToken(
                        "token-1", "Bearer", java.time.Instant.parse("2030-01-01T00:05:00Z")));

        SuiteExecutionResult result = executionService.runStep(suiteId, stepId, null);

        ArgumentCaptor<HttpEntity<?>> entity = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).exchange(
                eq(URI.create("https://api.example.test/orders")),
                eq(org.springframework.http.HttpMethod.GET),
                entity.capture(),
                eq(String.class));
        assertThat(entity.getValue().getHeaders().getFirst(HttpHeaders.AUTHORIZATION))
                .isEqualTo("Bearer token-1");
        StepExecutionResult stepResult = result.getSteps().get(0);
        assertThat(stepResult.getRequestHeaders().get("Authorization")).isEqualTo("<redacted>");
        assertThat(stepResult.getStatus()).isEqualTo("SUCCESS");
    }

    @Test
    void explicitManualAuthorizationAndDisabledModeSkipProvider() {
        step.setHeaders("[{\"key\":\"Authorization\",\"value\":\"Bearer manual\"}]");
        executionService.runStep(suiteId, stepId, null);
        verifyNoInteractions(provider);

        step.setHeaders("[]");
        step.setOauthMode(OAuthMode.DISABLED);
        executionService.runStep(suiteId, stepId, null);
        verifyNoInteractions(provider);
    }

    @Test
    void tokenFailureReturnsSafeErrorWithoutCallingTarget() {
        when(provider.getToken()).thenThrow(new OAuthTokenException(
                OAuthTokenErrorCode.OAUTH_TOKEN_ENDPOINT_UNAVAILABLE,
                "OAuth token endpoint is unavailable"));

        SuiteExecutionResult result = executionService.runStep(suiteId, stepId, null);

        StepExecutionResult stepResult = result.getSteps().get(0);
        assertThat(stepResult.getStatus()).isEqualTo("ERROR");
        assertThat(stepResult.getResponseCode()).isZero();
        assertThat(stepResult.getErrorMessage()).isEqualTo("OAuth token endpoint is unavailable");
        verify(restTemplate, never()).exchange(any(URI.class), any(), any(HttpEntity.class), eq(String.class));
    }

    @Test
    void curlUsesPreviewTokenAndNeverCallsProvider() {
        when(stepRepo.findByIdWithDetails(stepId)).thenReturn(Optional.of(step));

        String curl = executionService.generateCurl(suiteId, stepId, null);

        assertThat(curl).contains("Authorization: Bearer <redacted>");
        assertThat(curl).doesNotContain("token-1");
        verifyNoInteractions(provider);
        verifyNoInteractions(restTemplate);
    }

    private TestStep baseStep() {
        return TestStep.builder()
                .id(stepId)
                .name("orders")
                .method(HttpMethod.GET)
                .url("https://api.example.test/orders")
                .headers("[]")
                .queryParams("[]")
                .bodyType(BodyType.NONE)
                .body("")
                .disabledDefaultHeaders("[]")
                .dependencies(new LinkedHashSet<>())
                .responseHandlers(new LinkedHashSet<>())
                .verifications(new LinkedHashSet<>())
                .responseValidations(new LinkedHashSet<>())
                .build();
    }
}
