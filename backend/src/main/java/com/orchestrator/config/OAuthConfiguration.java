package com.orchestrator.config;

import com.orchestrator.oauth.ClientCredentialsOAuthTokenProvider;
import com.orchestrator.oauth.NoopOAuthTokenProvider;
import com.orchestrator.oauth.OAuthTokenErrorCode;
import com.orchestrator.oauth.OAuthTokenException;
import com.orchestrator.oauth.OAuthTokenProvider;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.time.Clock;
import java.time.Duration;

@Configuration
@EnableConfigurationProperties(OAuthProperties.class)
public class OAuthConfiguration {

    @Bean(name = "oauthRestTemplate")
    public RestTemplate oauthRestTemplate(RestTemplateBuilder builder, OAuthProperties properties) {
        if (properties.isEnabled()) {
            properties.validate();
        }
        long timeoutMs = properties.isEnabled() ? properties.getRequestTimeoutMs() : 10_000;
        return builder
                .setConnectTimeout(Duration.ofMillis(timeoutMs))
                .setReadTimeout(Duration.ofMillis(timeoutMs))
                .build();
    }

    @Bean(name = "oauthClock")
    public Clock oauthClock() {
        return Clock.systemUTC();
    }

    @Bean
    public OAuthTokenProvider oauthTokenProvider(
            OAuthProperties properties,
            @Qualifier("oauthRestTemplate") RestTemplate oauthRestTemplate,
            Clock oauthClock,
            Environment environment) {
        properties.validate();
        if (!properties.isEnabled()) {
            return new NoopOAuthTokenProvider();
        }

        URI endpoint = URI.create(properties.getTokenEndpoint().trim());
        if (environment.acceptsProfiles(Profiles.of("prod"))
                && !"https".equalsIgnoreCase(endpoint.getScheme())) {
            throw new OAuthTokenException(
                    OAuthTokenErrorCode.OAUTH_CONFIGURATION_INVALID,
                    "OAuth token endpoint must use https when the prod profile is active");
        }
        return new ClientCredentialsOAuthTokenProvider(properties, oauthRestTemplate, oauthClock);
    }
}
