package com.orchestrator.service;

import com.orchestrator.dto.StepExecutionResult;
import com.orchestrator.dto.SuiteExecutionResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Fan-out SSE progress for an existing run (batch/scheduled/manual).
 * Buffers completed steps so late joiners can catch up.
 */
@Component
@Slf4j
public class RunProgressRegistry {

    private static final long SSE_TIMEOUT = 3_600_000L;

    private final ConcurrentHashMap<UUID, RunSession> sessions = new ConcurrentHashMap<>();

    public void open(UUID runId) {
        RunSession session = sessions.computeIfAbsent(runId, id -> new RunSession());
        session.markOpened();
    }

    public void emitStep(UUID runId, StepExecutionResult step) {
        RunSession session = sessions.get(runId);
        if (session == null) {
            return;
        }
        session.bufferStep(step);
        session.broadcast("step", step);
    }

    public void complete(UUID runId, SuiteExecutionResult result) {
        RunSession session = sessions.get(runId);
        if (session == null) {
            return;
        }
        session.markComplete(result);
        session.broadcast("complete", result);
        session.completeEmitters();
        sessions.remove(runId, session);
    }

    public void error(UUID runId, String message) {
        RunSession session = sessions.get(runId);
        if (session == null) {
            return;
        }
        String safeMessage = message != null ? message : "Unknown error";
        session.markError(safeMessage);
        session.broadcast("run-error", Map.of("message", safeMessage));
        session.completeEmitters();
        sessions.remove(runId, session);
    }

    public void close(UUID runId) {
        RunSession session = sessions.remove(runId);
        if (session != null && !session.isTerminal()) {
            session.completeEmitters();
        }
    }

    public boolean hasActiveSession(UUID runId) {
        RunSession session = sessions.get(runId);
        return session != null && !session.isTerminal();
    }

    /**
     * Attach a listener to a live run. Creates a session if the run is still
     * starting (listener arrived before {@link #open}).
     */
    public SseEmitter registerListener(UUID runId) {
        RunSession session = sessions.computeIfAbsent(runId, id -> new RunSession());
        SseEmitter emitter = new SseEmitter(SSE_TIMEOUT);
        session.addListener(emitter);

        Runnable cleanup = () -> {
            session.removeListener(emitter);
            if (session.shouldDiscard()) {
                sessions.remove(runId, session);
            }
        };
        emitter.onCompletion(cleanup);
        emitter.onTimeout(cleanup);
        emitter.onError(t -> cleanup.run());

        Thread.ofVirtual().name("sse-run-replay-" + runId).start(() -> {
            try {
                emitter.send(SseEmitter.event()
                        .name("run-started")
                        .data(Map.of("runId", runId.toString()), MediaType.APPLICATION_JSON));

                for (StepExecutionResult step : session.snapshotSteps()) {
                    emitter.send(SseEmitter.event()
                            .name("step")
                            .data(step, MediaType.APPLICATION_JSON));
                }

                SuiteExecutionResult completed = session.getFinalResult();
                if (completed != null) {
                    emitter.send(SseEmitter.event()
                            .name("complete")
                            .data(completed, MediaType.APPLICATION_JSON));
                    emitter.complete();
                    return;
                }

                String errorMessage = session.getErrorMessage();
                if (errorMessage != null) {
                    emitter.send(SseEmitter.event()
                            .name("run-error")
                            .data(Map.of("message", errorMessage), MediaType.APPLICATION_JSON));
                    emitter.complete();
                }
            } catch (Exception e) {
                log.debug("Failed to replay run progress for {}: {}", runId, e.getMessage());
                try {
                    emitter.completeWithError(e);
                } catch (Exception ignored) {
                }
            }
        });

        return emitter;
    }

    private static final class RunSession {
        private final List<StepExecutionResult> steps = new ArrayList<>();
        private final CopyOnWriteArrayList<SseEmitter> listeners = new CopyOnWriteArrayList<>();
        private SuiteExecutionResult finalResult;
        private String errorMessage;
        private boolean terminal;
        private boolean opened;

        synchronized void markOpened() {
            this.opened = true;
        }

        synchronized void bufferStep(StepExecutionResult step) {
            steps.add(step);
        }

        synchronized List<StepExecutionResult> snapshotSteps() {
            return List.copyOf(steps);
        }

        synchronized void markComplete(SuiteExecutionResult result) {
            this.finalResult = result;
            this.terminal = true;
        }

        synchronized void markError(String message) {
            this.errorMessage = message;
            this.terminal = true;
        }

        synchronized SuiteExecutionResult getFinalResult() {
            return finalResult;
        }

        synchronized String getErrorMessage() {
            return errorMessage;
        }

        synchronized boolean isTerminal() {
            return terminal;
        }

        synchronized boolean shouldDiscard() {
            return listeners.isEmpty() && !opened && !terminal && steps.isEmpty();
        }

        void addListener(SseEmitter emitter) {
            listeners.add(emitter);
        }

        void removeListener(SseEmitter emitter) {
            listeners.remove(emitter);
        }

        void broadcast(String eventName, Object data) {
            for (SseEmitter emitter : listeners) {
                try {
                    emitter.send(SseEmitter.event().name(eventName).data(data, MediaType.APPLICATION_JSON));
                } catch (IOException e) {
                    log.debug("Failed to send {} to run listener: {}", eventName, e.getMessage());
                }
            }
        }

        void completeEmitters() {
            for (SseEmitter emitter : listeners) {
                try {
                    emitter.complete();
                } catch (Exception e) {
                    log.debug("Failed to complete run SSE emitter: {}", e.getMessage());
                }
            }
            listeners.clear();
        }
    }
}
