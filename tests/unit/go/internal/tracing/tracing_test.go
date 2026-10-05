package tracing_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/orochibraru/homerun/internal/tracing"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/trace/noop"
)

func mustTraceID(t *testing.T, hex string) trace.TraceID {
	t.Helper()
	id, err := trace.TraceIDFromHex(hex)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func mustSpanID(t *testing.T, hex string) trace.SpanID {
	t.Helper()
	id, err := trace.SpanIDFromHex(hex)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestRowFromSpanMapsEveryColumn(t *testing.T) {
	traceID := mustTraceID(t, "0af7651916cd43dd8448eb211c80319c")
	paris := time.FixedZone("Paris", 2*60*60)
	start := time.Date(2026, 10, 5, 14, 0, 0, 250_000_000, paris)
	stub := tracetest.SpanStub{
		Attributes: []attribute.KeyValue{
			attribute.String("homerun.job.type", "deploy"),
			attribute.Int("homerun.job.attempt", 2),
			attribute.Bool("retried", true),
		},
		EndTime: start.Add(1500 * time.Microsecond),
		Events: []sdktrace.Event{{
			Attributes: []attribute.KeyValue{attribute.String("exception.message", "boom")},
			Name:       "exception",
			Time:       start.Add(time.Millisecond),
		}},
		Name:     "job deploy",
		Parent:   trace.NewSpanContext(trace.SpanContextConfig{SpanID: mustSpanID(t, "00f067aa0cd902b7"), TraceID: traceID}),
		Resource: resource.NewSchemaless(attribute.String("service.name", "homerun-worker"), attribute.String("service.version", "1.2.3")),
		SpanContext: trace.NewSpanContext(trace.SpanContextConfig{
			SpanID: mustSpanID(t, "b7ad6b7169203331"), TraceID: traceID,
		}),
		SpanKind:  trace.SpanKindInternal,
		StartTime: start,
		Status:    sdktrace.Status{Code: codes.Error, Description: "boom"},
	}

	row := tracing.RowFromSpan(stub.Snapshot())

	if row.TraceID != "0af7651916cd43dd8448eb211c80319c" || row.SpanID != "b7ad6b7169203331" {
		t.Fatalf("ids = %s/%s", row.TraceID, row.SpanID)
	}
	if row.ParentSpanID == nil || *row.ParentSpanID != "00f067aa0cd902b7" {
		t.Fatalf("parent = %v", row.ParentSpanID)
	}
	if row.Name != "job deploy" || row.Kind != 1 {
		t.Fatalf("name/kind = %s/%d", row.Name, row.Kind)
	}
	if row.Start.Location() != time.UTC || row.Start.Hour() != 12 || !row.Start.Equal(start) {
		t.Fatalf("start = %s, want 12:00 UTC", row.Start)
	}
	if row.DurationMs != 1.5 {
		t.Fatalf("duration = %v, want 1.5", row.DurationMs)
	}
	if row.StatusCode != tracing.StatusError || row.StatusMessage == nil || *row.StatusMessage != "boom" {
		t.Fatalf("status = %d/%v", row.StatusCode, row.StatusMessage)
	}
	if row.Attributes["homerun.job.type"] != "deploy" || row.Attributes["homerun.job.attempt"] != int64(2) || row.Attributes["retried"] != true {
		t.Fatalf("attributes = %v", row.Attributes)
	}
	if row.ServiceName != "homerun-worker" || row.ResourceAttributes["service.version"] != "1.2.3" {
		t.Fatalf("resource = %s %v", row.ServiceName, row.ResourceAttributes)
	}
	if len(row.Events) != 1 || row.Events[0].Name != "exception" || row.Events[0].Time != "2026-10-05T12:00:00.251Z" ||
		row.Events[0].Attributes["exception.message"] != "boom" {
		t.Fatalf("events = %+v", row.Events)
	}
}

func TestRowFromSpanRootWithoutResource(t *testing.T) {
	stub := tracetest.SpanStub{
		Name: "root",
		SpanContext: trace.NewSpanContext(trace.SpanContextConfig{
			SpanID: mustSpanID(t, "b7ad6b7169203331"), TraceID: mustTraceID(t, "0af7651916cd43dd8448eb211c80319c"),
		}),
		Status: sdktrace.Status{Code: codes.Ok},
	}

	row := tracing.RowFromSpan(stub.Snapshot())

	if row.ParentSpanID != nil || row.StatusMessage != nil {
		t.Fatalf("parent/message = %v/%v, want nil", row.ParentSpanID, row.StatusMessage)
	}
	if row.StatusCode != tracing.StatusOK || row.ServiceName != tracing.ServiceName {
		t.Fatalf("status/service = %d/%s", row.StatusCode, row.ServiceName)
	}
	if row.Events == nil || len(row.Events) != 0 || len(row.ResourceAttributes) != 0 {
		t.Fatalf("events/resource = %v/%v", row.Events, row.ResourceAttributes)
	}
}

func TestRowFromSpanUnsetStatus(t *testing.T) {
	row := tracing.RowFromSpan(tracetest.SpanStub{Name: "quiet"}.Snapshot())
	if row.StatusCode != tracing.StatusUnset {
		t.Fatalf("status = %d, want unset", row.StatusCode)
	}
}

// recordSpans installs an in-memory provider for the test and returns its exporter.
func recordSpans(t *testing.T) *tracetest.InMemoryExporter {
	t.Helper()
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() { otel.SetTracerProvider(previous) })
	return exporter
}

func TestStageRecordsAChildSpanAndItsError(t *testing.T) {
	exporter := recordSpans(t)
	ctx, parent := tracing.Tracer().Start(context.Background(), "job deploy")
	failure := errors.New("pull refused")

	if err := tracing.Stage(ctx, "pull", func(context.Context) error { return failure }); !errors.Is(err, failure) {
		t.Fatalf("Stage returned %v, want the stage's own error", err)
	}
	if err := tracing.Stage(ctx, "deploy", func(context.Context) error { return nil }); err != nil {
		t.Fatal(err)
	}
	parent.End()

	spans := exporter.GetSpans()
	if len(spans) != 3 {
		t.Fatalf("got %d spans, want 3", len(spans))
	}
	pull, deploy, root := spans[0], spans[1], spans[2]
	if pull.Name != "pull" || pull.Parent.SpanID() != root.SpanContext.SpanID() {
		t.Fatalf("pull = %s under %s", pull.Name, pull.Parent.SpanID())
	}
	if pull.Status.Code != codes.Error || pull.Status.Description != "pull refused" || len(pull.Events) != 1 {
		t.Fatalf("pull status = %+v events=%d", pull.Status, len(pull.Events))
	}
	if deploy.Status.Code != codes.Ok {
		t.Fatalf("deploy status = %+v", deploy.Status)
	}
}

func TestSpansAreNoOpsWithoutSetup(t *testing.T) {
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(noop.NewTracerProvider())
	t.Cleanup(func() { otel.SetTracerProvider(previous) })
	ran := false
	if err := tracing.Stage(context.Background(), "agent", func(ctx context.Context) error {
		ran = true
		if trace.SpanFromContext(ctx).SpanContext().IsValid() {
			t.Error("a no-op provider shouldn't hand out a real span")
		}
		return nil
	}); err != nil || !ran {
		t.Fatalf("Stage = %v ran=%v", err, ran)
	}
}
