package com.orchestrator;

import java.net.URI;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.client.RestTemplate;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Verifies context-root slash redirect stays relative (agent-session nginx style),
 * so public host/scheme survive Kong/Ingress.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "server.servlet.context-path=/orchestapi",
                "spring.datasource.url=jdbc:h2:mem:contextroot;INIT=CREATE SCHEMA IF NOT EXISTS orchestrator"
        })
@ActiveProfiles("test")
class ContextRootRoutingIntegrationTest {

    @LocalServerPort
    private int port;

    @Autowired
    private TestRestTemplate restTemplate;

    @Test
    void exactContextPathRedirectsWithRelativeLocation() {
        RestTemplate noFollow = new RestTemplateBuilder()
                .requestFactory(() -> {
                    SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory() {
                        @Override
                        protected void prepareConnection(
                                java.net.HttpURLConnection connection, String httpMethod)
                                throws java.io.IOException {
                            super.prepareConnection(connection, httpMethod);
                            connection.setInstanceFollowRedirects(false);
                        }
                    };
                    return factory;
                })
                .build();

        ResponseEntity<Void> response = noFollow.getForEntity(
                "http://localhost:" + port + "/orchestapi", Void.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FOUND);
        URI location = response.getHeaders().getLocation();
        assertThat(location).isNotNull();
        assertThat(location.toString()).isEqualTo("/orchestapi/");
        assertThat(location.isAbsolute()).isFalse();
    }

    @Test
    void contextPathWithTrailingSlashServesSpa() {
        ResponseEntity<String> response = restTemplate.getForEntity(
                "http://localhost:" + port + "/orchestapi/", String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).contains("spa-index");
    }

    @Test
    void exactContextPathFollowsRelativeRedirectToSpa() {
        ResponseEntity<String> response = restTemplate.getForEntity(
                "http://localhost:" + port + "/orchestapi", String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).contains("spa-index");
    }
}
