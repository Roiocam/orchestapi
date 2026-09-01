package com.orchestrator.controller;

import com.orchestrator.dto.BatchStartResponse;
import com.orchestrator.dto.CollectionRequest;
import com.orchestrator.dto.CollectionResponse;
import com.orchestrator.dto.RunRequest;
import com.orchestrator.service.CollectionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/collections")
@RequiredArgsConstructor
public class CollectionController {

    private final CollectionService service;

    @GetMapping
    public List<CollectionResponse> findAll(@RequestParam(required = false) UUID projectId) {
        return service.findAll(projectId);
    }

    @GetMapping("/{id}")
    public CollectionResponse findById(@PathVariable UUID id) {
        return service.findById(id);
    }

    @PostMapping
    public ResponseEntity<CollectionResponse> create(@Valid @RequestBody CollectionRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.create(request));
    }

    @PutMapping("/{id}")
    public CollectionResponse update(@PathVariable UUID id, @Valid @RequestBody CollectionRequest request) {
        return service.update(id, request);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/run")
    public ResponseEntity<BatchStartResponse> run(@PathVariable UUID id,
                                                  @RequestBody(required = false) RunRequest request) {
        return ResponseEntity.accepted().body(service.run(id, request));
    }
}
