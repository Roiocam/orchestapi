package com.orchestrator.config;

import java.io.IOException;

import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

/**
 * Serves {@code index.html} for client-side React Router paths on refresh/deep-link.
 * Existing files under {@code classpath:/static/} are returned as-is; API/mock/webhook/
 * actuator prefixes and missing assets with file extensions stay 404.
 */
@Configuration
public class SpaWebConfig implements WebMvcConfigurer {

    private static final Resource INDEX_HTML = new ClassPathResource("/static/index.html");

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // Must run before Boot's default /** mapping (LOWEST_PRECEDENCE - 10),
        // otherwise deep links 404 before this SPA fallback can run.
        registry.setOrder(Ordered.LOWEST_PRECEDENCE - 20);
        registry.addResourceHandler("/**")
                .addResourceLocations("classpath:/static/")
                .resourceChain(true)
                .addResolver(new PathResourceResolver() {
                    @Override
                    protected Resource getResource(String resourcePath, Resource location) throws IOException {
                        Resource requested = location.createRelative(resourcePath);
                        if (requested.exists() && requested.isReadable()) {
                            return requested;
                        }
                        if (!shouldServeSpaIndex(resourcePath)) {
                            return null;
                        }
                        return INDEX_HTML.exists() && INDEX_HTML.isReadable() ? INDEX_HTML : null;
                    }
                });
    }

    static boolean shouldServeSpaIndex(String resourcePath) {
        if (resourcePath == null || resourcePath.isBlank()) {
            return true;
        }
        String path = resourcePath.startsWith("/") ? resourcePath.substring(1) : resourcePath;
        if (isBackendPrefix(path)) {
            return false;
        }
        int slash = path.lastIndexOf('/');
        String lastSegment = slash >= 0 ? path.substring(slash + 1) : path;
        // Missing hashed assets / favicon / svg should 404, not return the SPA shell.
        return !lastSegment.contains(".");
    }

    private static boolean isBackendPrefix(String path) {
        return startsWithSegment(path, "api")
                || startsWithSegment(path, "mock")
                || startsWithSegment(path, "webhook")
                || startsWithSegment(path, "actuator");
    }

    private static boolean startsWithSegment(String path, String segment) {
        return path.equals(segment) || path.startsWith(segment + "/");
    }
}
