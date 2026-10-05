package worker_test

import (
	"context"
	"errors"
	"testing"

	"github.com/orochibraru/homerun/internal/jobs"
	"github.com/orochibraru/homerun/internal/tracing"
	"github.com/orochibraru/homerun/internal/worker"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func attributeOf(stub tracetest.SpanStub, key string) attribute.Value {
	for _, kv := range stub.Attributes {
		if string(kv.Key) == key {
			return kv.Value
		}
	}
	return attribute.Value{}
}

func TestAJobIsTracedWithAChildSpanPerStage(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter)))
	t.Cleanup(func() { otel.SetTracerProvider(previous) })

	store := &fakeStore{queue: []*worker.ClaimedJob{{Attempts: 2, ID: "j1", JobType: "deploy", Spec: sealed(t, `{}`)}}}
	w := testWorker(t, store, map[string]worker.Executor{
		"deploy": func(ctx context.Context, _ jobs.Job) (map[string]any, error) {
			if err := tracing.Stage(ctx, "pull", func(context.Context) error { return nil }); err != nil {
				return nil, err
			}
			return nil, tracing.Stage(ctx, "deploy", func(context.Context) error { return errors.New("port in use") })
		},
	})
	runUntil(t, w, func() bool { store.mu.Lock(); defer store.mu.Unlock(); return len(store.finished) == 1 })

	byName := map[string]tracetest.SpanStub{}
	for _, span := range exporter.GetSpans() {
		byName[span.Name] = span
	}
	root, ok := byName["job deploy"]
	if !ok {
		t.Fatalf("no job span among %d spans", len(byName))
	}
	if root.Parent.IsValid() {
		t.Error("the job span is a trace's root")
	}
	if attributeOf(root, "homerun.job.id").AsString() != "j1" ||
		attributeOf(root, "homerun.job.type").AsString() != "deploy" ||
		attributeOf(root, "homerun.job.attempt").AsInt64() != 2 ||
		attributeOf(root, "homerun.job.outcome").AsString() != "failed" {
		t.Errorf("job span attributes = %v", root.Attributes)
	}
	if root.Status.Code != codes.Error || root.Status.Description != "port in use" {
		t.Errorf("job span status = %+v", root.Status)
	}
	execute := byName["execute"]
	if execute.Parent.SpanID() != root.SpanContext.SpanID() {
		t.Error("execute is a child of the job span")
	}
	for _, stage := range []string{"pull", "deploy"} {
		if byName[stage].Parent.SpanID() != execute.SpanContext.SpanID() {
			t.Errorf("%s is a child of execute", stage)
		}
	}
	if byName["pull"].Status.Code != codes.Ok || byName["deploy"].Status.Code != codes.Error {
		t.Errorf("stage statuses = %+v / %+v", byName["pull"].Status, byName["deploy"].Status)
	}
	if finish := byName["finish"]; finish.Parent.SpanID() != root.SpanContext.SpanID() || finish.Status.Code != codes.Ok {
		t.Errorf("finish span = %+v", finish)
	}
	for _, span := range exporter.GetSpans() {
		if span.SpanContext.TraceID() != root.SpanContext.TraceID() {
			t.Errorf("%s is in another trace", span.Name)
		}
	}
}

func TestASucceededJobSpanIsOk(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter)))
	t.Cleanup(func() { otel.SetTracerProvider(previous) })

	store := &fakeStore{queue: []*worker.ClaimedJob{{Attempts: 1, ID: "ok", JobType: "echo", Spec: sealed(t, `{}`)}}}
	w := testWorker(t, store, map[string]worker.Executor{
		"echo": func(context.Context, jobs.Job) (map[string]any, error) { return map[string]any{}, nil },
	})
	runUntil(t, w, func() bool { store.mu.Lock(); defer store.mu.Unlock(); return len(store.finished) == 1 })

	for _, span := range exporter.GetSpans() {
		if span.Name == "job echo" {
			if span.Status.Code != codes.Ok || attributeOf(span, "homerun.job.outcome").AsString() != "succeeded" {
				t.Errorf("job span = %+v", span)
			}
			return
		}
	}
	t.Fatal("no job span recorded")
}
