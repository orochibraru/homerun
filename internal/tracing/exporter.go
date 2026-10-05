package tracing

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// OTLP's status codes, which trace_span.status_code stores. They differ from
// the Go SDK's own codes.Code values.
const (
	StatusUnset = 0
	StatusOK    = 1
	StatusError = 2
)

// eventTimeLayout is how an event's time is stored: UTC, millisecond
// precision, the same shape the app writes for spans it ingests.
const eventTimeLayout = "2006-01-02T15:04:05.000Z07:00"

// Event is one span event as trace_span.events stores it.
type Event struct {
	Attributes map[string]any `json:"attributes"`
	Name       string         `json:"name"`
	Time       string         `json:"time"`
}

// Row is one trace_span row.
type Row struct {
	Attributes         map[string]any
	DurationMs         float64
	End                time.Time
	Events             []Event
	Kind               int
	Name               string
	ParentSpanID       *string
	ResourceAttributes map[string]any
	ServiceName        string
	SpanID             string
	Start              time.Time
	StatusCode         int
	StatusMessage      *string
	TraceID            string
}

// RowFromSpan maps a finished span to its trace_span row: hex ids, UTC
// timestamps, OTLP's kind and status codes, and attributes flattened to plain
// JSON values. Worker spans carry no service id.
func RowFromSpan(span sdktrace.ReadOnlySpan) Row {
	row := Row{
		Attributes:         attributeMap(span.Attributes()),
		DurationMs:         float64(span.EndTime().Sub(span.StartTime()).Microseconds()) / 1000,
		End:                span.EndTime().UTC(),
		Events:             make([]Event, 0, len(span.Events())),
		Kind:               int(span.SpanKind()),
		Name:               span.Name(),
		ResourceAttributes: map[string]any{},
		ServiceName:        ServiceName,
		SpanID:             span.SpanContext().SpanID().String(),
		Start:              span.StartTime().UTC(),
		StatusCode:         statusCode(span.Status().Code),
		TraceID:            span.SpanContext().TraceID().String(),
	}
	if parent := span.Parent(); parent.SpanID().IsValid() {
		id := parent.SpanID().String()
		row.ParentSpanID = &id
	}
	if message := span.Status().Description; message != "" {
		row.StatusMessage = &message
	}
	if res := span.Resource(); res != nil {
		row.ResourceAttributes = attributeMap(res.Attributes())
		if name, ok := row.ResourceAttributes["service.name"].(string); ok && name != "" {
			row.ServiceName = name
		}
	}
	for _, event := range span.Events() {
		row.Events = append(row.Events, Event{
			Attributes: attributeMap(event.Attributes),
			Name:       event.Name,
			Time:       event.Time.UTC().Format(eventTimeLayout),
		})
	}
	return row
}

// statusCode converts the Go SDK's status code to OTLP's.
func statusCode(code codes.Code) int {
	switch code {
	case codes.Error:
		return StatusError
	case codes.Ok:
		return StatusOK
	default:
		return StatusUnset
	}
}

// attributeMap flattens attributes to a JSON-ready map.
func attributeMap(attributes []attribute.KeyValue) map[string]any {
	flat := make(map[string]any, len(attributes))
	for _, kv := range attributes {
		flat[string(kv.Key)] = kv.Value.AsInterface()
	}
	return flat
}

// PGExporter is an OpenTelemetry SpanExporter writing straight into the
// app's trace_span table, so the worker's own traces need no collector.
type PGExporter struct {
	Pool *pgxpool.Pool
}

// insertSQL inserts one row, skipping a span already stored.
const insertSQL = `insert into trace_span (trace_id, span_id, parent_span_id, name, kind,
	start_time, end_time, duration_ms, status_code, status_message, attributes, events,
	resource_attributes, service_id, service_name)
	values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, null, $14)
	on conflict (trace_id, span_id) do nothing`

// ExportSpans implements sdktrace.SpanExporter: every span becomes a row, in
// one round trip.
func (e *PGExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	batch := &pgx.Batch{}
	for _, span := range spans {
		row := RowFromSpan(span)
		attributes, err := json.Marshal(row.Attributes)
		if err != nil {
			return err
		}
		events, err := json.Marshal(row.Events)
		if err != nil {
			return err
		}
		resourceAttributes, err := json.Marshal(row.ResourceAttributes)
		if err != nil {
			return err
		}
		batch.Queue(insertSQL, row.TraceID, row.SpanID, row.ParentSpanID, row.Name, row.Kind,
			row.Start, row.End, row.DurationMs, row.StatusCode, row.StatusMessage,
			string(attributes), string(events), string(resourceAttributes), row.ServiceName)
	}
	if batch.Len() == 0 {
		return nil
	}
	return e.Pool.SendBatch(ctx, batch).Close()
}

// Shutdown implements sdktrace.SpanExporter. The pool belongs to the worker,
// so there's nothing of the exporter's own to release.
func (e *PGExporter) Shutdown(context.Context) error {
	return nil
}
