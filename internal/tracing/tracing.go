// Package tracing gives the homerun worker its own OpenTelemetry traces: a
// span per job and per stage, exported straight into the app's trace_span
// table so they show up on the instance's Monitoring → Traces page with or
// without the OpenTelemetry collector running. Without Setup (agent mode,
// tests), every span is a no-op.
package tracing

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/orochibraru/homerun/internal/buildinfo"
	"github.com/orochibraru/homerun/internal/logging"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// ServiceName is the service.name every worker span carries, and the
// trace_span.service_name the instance's traces page filters on.
const ServiceName = "homerun-worker"

const instrumentationName = "github.com/orochibraru/homerun/internal/worker"

// Tracer is the worker's tracer, from whichever provider is installed
// globally: the Postgres-exporting one after Setup, a no-op before.
func Tracer() trace.Tracer {
	return otel.Tracer(instrumentationName)
}

// Stage runs fn inside a child span of ctx's span named name, and records
// fn's error on it. The error is returned unchanged.
func Stage(ctx context.Context, name string, fn func(context.Context) error) error {
	ctx, span := Tracer().Start(ctx, name)
	defer span.End()
	err := fn(ctx)
	Record(span, err)
	return err
}

// Record marks span failed with err, or succeeded when err is nil.
func Record(span trace.Span, err error) {
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return
	}
	span.SetStatus(codes.Ok, "")
}

// Setup installs a tracer provider that batches every finished span into
// trace_span through pool, and returns its shutdown, which flushes what's
// still buffered.
func Setup(pool *pgxpool.Pool) func(context.Context) error {
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(&PGExporter{Pool: pool}),
		sdktrace.WithResource(resource.NewSchemaless(
			attribute.String("service.name", ServiceName),
			attribute.String("service.version", buildinfo.Version),
		)),
	)
	otel.SetTracerProvider(provider)
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(err error) {
		logging.Warnf("tracing", "%s", err)
	}))
	return provider.Shutdown
}
