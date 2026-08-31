package com.orchestrator.config;

import com.orchestrator.oauth.ClientCredentialsOAuthTokenProvider;
import com.orchestrator.oauth.OAuthTokenProvider;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;
import java.time.Duration;

@Configuration
public class OAuthConfiguration {

    @Bean(name = "oauthClock")
    public Clock oauthClock() {
        return Clock.systemUTC();
    }

    @Bean
    public OAuthTokenProvider oauthTokenProvider(
            RestTemplateBuilder restTemplateBuilder,
            Clock oauthClock) {
        return new ClientCredentialsOAuthTokenProvider(
                timeoutMs -> restTemplateBuilder
                        .setConnectTimeout(Duration.ofMillis(timeoutMs))
                        .setReadTimeout(Duration.ofMillis(timeoutMs))
                        .build(),
                oauthClock);
    }
}
