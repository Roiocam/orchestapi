package com.orchestrator;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.orchestrator.dto.StepExecutionResult;
import com.orchestrator.dto.SuiteExecutionResult;
import com.orchestrator.model.Environment;
import com.orchestrator.model.EnvironmentOAuthConfig;
import com.orchestrator.model.HttpMethod;
import com.orchestrator.model.ResponseAction;
import com.orchestrator.model.StepResponseHandler;
import com.orchestrator.model.StepResponseValidation;
import com.orchestrator.model.TestStep;
import com.orchestrator.model.TestSuite;
import com.orchestrator.model.enums.AssertionOperator;
import com.orchestrator.model.enums.BodyType;
import com.orchestrator.model.enums.ResponseValidationType;
import com.orchestrator.oauth.DefaultOAuthRequestAuthorizer;
import com.orchestrator.oauth.OAuthTokenProvider;
import com.orchestrator.oauth.RequestHeaderRedactor;
import com.orchestrator.repository.EnvironmentFileRepository;
import com.orchestrator.repository.EnvironmentRepository;
import com.orchestrator.repository.TestStepRepository;
import com.orchestrator.repository.TestSuiteRepository;
import com.orchestrator.service.ExecutionService;
import com.orchestrator.service.ResponseValidationService;
import com.orchestrator.service.VerificationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
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
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ExecutionServiceRetryValidationTest {

    private UUID suiteId;
    private UUID stepId;
    private UUID environmentId;
    private TestSuite suite;
    private TestStep step;
    private Environment environment;
    private TestStepRepository stepRepo;
    private RestTemplate restTemplate;
    private ExecutionService executionService;

    @BeforeEach
    void setUp() {
        suiteId = UUID.randomUUID();
        stepId = UUID.randomUUID();
        environmentId = UUID.randomUUID();
        suite = TestSuite.builder().id(suiteId).name("retry-suite").description("").build();
        suite.setDefaultEnvironmentId(environmentId);

        EnvironmentOAuthConfig oauthConfig = EnvironmentOAuthConfig.disabled(environmentId);
        environment = Environment.builder()
                .id(environmentId)
                .name("env")
                .baseUrl("https://api.example.test")
                .oauthConfig(oauthConfig)
                .build();
        oauthConfig.setEnvironment(environment);

        step = TestStep.builder()
                .id(stepId)
                .name("poll_sync_run_failed")
                .method(HttpMethod.GET)
                .url("https://api.example.test/sync-runs")
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
        step.setSuite(suite);

        StepResponseHandler retryOn200 = StepResponseHandler.builder()
                .id(UUID.randomUUID())
                .step(step)
                .matchCode("200")
                .action(ResponseAction.RETRY)
                .retryCount(3)
                .retryDelaySeconds(0)
                .priority(0)
                .build();
        step.getResponseHandlers().add(retryOn200);

        StepResponseValidation statusFailed = StepResponseValidation.builder()
                .id(UUID.randomUUID())
                .step(step)
                .validationType(ResponseValidationType.BODY_FIELD)
                .jsonPath("$.data[0].status")
                .operator(AssertionOperator.EQUALS)
                .expectedValue("FAILED")
                .sortOrder(0)
                .build();
        StepResponseValidation errorCodeExists = StepResponseValidation.builder()
                .id(UUID.randomUUID())
                .step(step)
                .validationType(ResponseValidationType.BODY_FIELD)
                .jsonPath("$.data[0].errorCode")
                .operator(AssertionOperator.EXISTS)
                .expectedValue("")
                .sortOrder(1)
                .build();
        step.getResponseValidations().add(statusFailed);
        step.getResponseValidations().add(errorCodeExists);

        stepRepo = mock(TestStepRepository.class);
        TestSuiteRepository suiteRepo = mock(TestSuiteRepository.class);
        EnvironmentRepository envRepo = mock(EnvironmentRepository.class);
        EnvironmentFileRepository fileRepo = mock(EnvironmentFileRepository.class);
        restTemplate = mock(RestTemplate.class);
        VerificationService verificationService = mock(VerificationService.class);
        OAuthTokenProvider provider = mock(OAuthTokenProvider.class);

        when(suiteRepo.findById(suiteId)).thenReturn(Optional.of(suite));
        when(stepRepo.findBySuiteIdWithDetails(suiteId)).thenReturn(List.of(step));
        when(stepRepo.findBySuiteIdWithVerifications(suiteId)).thenReturn(List.of(step));
        when(stepRepo.findBySuiteIdWithResponseValidations(suiteId)).thenReturn(List.of(step));
        when(envRepo.findByIdWithDetails(environmentId)).thenReturn(Optional.of(environment));
        when(envRepo.findByIdWithConnectors(environmentId)).thenReturn(Optional.of(environment));
        doReturn(Collections.emptyMap()).when(verificationService)
                .startPreListeners(any(), any(), any(), any());

        executionService = new ExecutionService(
                stepRepo,
                suiteRepo,
                envRepo,
                fileRepo,
                new ObjectMapper(),
                restTemplate,
                verificationService,
                new ResponseValidationService(new ObjectMapper()),
                new DefaultOAuthRequestAuthorizer(provider),
                new RequestHeaderRedactor());
    }

    @Test
    void retryStopsEarlyWhenResponseValidationsPass() {
        when(restTemplate.exchange(any(URI.class), any(), any(HttpEntity.class), eq(String.class)))
                .thenReturn(ResponseEntity.ok("""
                        {"data":[{"status":"FAILED","errorCode":"PROFILE_SYNC_FAILED"}]}
                        """));

        SuiteExecutionResult result = executionService.runStep(suiteId, stepId, null);

        StepExecutionResult stepResult = result.getSteps().get(0);
        assertThat(stepResult.getStatus()).isEqualTo("SUCCESS");
        assertThat(stepResult.getErrorMessage()).isNull();
        assertThat(stepResult.getResponseValidationResults()).hasSize(2);
        assertThat(stepResult.getResponseValidationResults())
                .allMatch(v -> v.isPassed());
        verify(restTemplate, times(1))
                .exchange(any(URI.class), any(), any(HttpEntity.class), eq(String.class));
    }

    @Test
    void retryContinuesUntilValidationsPass() {
        when(restTemplate.exchange(any(URI.class), any(), any(HttpEntity.class), eq(String.class)))
                .thenReturn(ResponseEntity.ok("""
                        {"data":[{"status":"SYNCING"}]}
                        """))
                .thenReturn(ResponseEntity.ok("""
                        {"data":[{"status":"FAILED","errorCode":"PROFILE_SYNC_FAILED"}]}
                        """));

        SuiteExecutionResult result = executionService.runStep(suiteId, stepId, null);

        StepExecutionResult stepResult = result.getSteps().get(0);
        assertThat(stepResult.getStatus()).isEqualTo("RETRIED");
        assertThat(stepResult.getResponseValidationResults()).hasSize(2);
        assertThat(stepResult.getResponseValidationResults())
                .allMatch(v -> v.isPassed());
        verify(restTemplate, times(2))
                .exchange(any(URI.class), any(), any(HttpEntity.class), eq(String.class));
    }

    @Test
    void exhaustedRetriesKeepsValidationResults() {
        when(restTemplate.exchange(any(URI.class), any(), any(HttpEntity.class), eq(String.class)))
                .thenReturn(ResponseEntity.ok("""
                        {"data":[{"status":"SYNCING"}]}
                        """));

        SuiteExecutionResult result = executionService.runStep(suiteId, stepId, null);

        StepExecutionResult stepResult = result.getSteps().get(0);
        assertThat(stepResult.getStatus()).isEqualTo("ERROR");
        assertThat(stepResult.getErrorMessage()).isEqualTo("Exhausted retries for response code 200");
        assertThat(stepResult.getResponseValidationResults()).isNotEmpty();
        assertThat(stepResult.getResponseValidationResults())
                .anyMatch(v -> !v.isPassed());
        // attempt 0..retryCount inclusive => 4 calls for retryCount=3
        verify(restTemplate, times(4))
                .exchange(any(URI.class), any(), any(HttpEntity.class), eq(String.class));
    }
}
