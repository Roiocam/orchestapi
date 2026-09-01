package com.orchestrator.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

import java.time.DateTimeException;
import java.time.ZoneId;

@Configuration
public class SchedulerConfig {

    @Bean
    public TaskScheduler taskScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(4);
        scheduler.setThreadNamePrefix("cron-run-");
        scheduler.setDaemon(true);
        scheduler.initialize();
        return scheduler;
    }

    @Bean
    public ZoneId scheduleZoneId(
            @Value("${orchestapi.schedule.timezone:Asia/Shanghai}") String timezone) {
        try {
            return ZoneId.of(timezone);
        } catch (DateTimeException e) {
            throw new IllegalStateException(
                    "Invalid orchestapi.schedule.timezone '" + timezone + "': " + e.getMessage(), e);
        }
    }
}
