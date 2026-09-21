// Package logging is the Go binaries' leveled logger, matching the SvelteKit
// app's own LOG_LEVEL convention so one variable sets how loud the whole
// instance is rather than each process having its own idea.
//
// It deliberately stays this small. The worker's output is read in
// `docker logs` next to the app's, so what matters is that a line says which
// subsystem it came from and that a quiet default can be turned up to
// something genuinely chatty when a deploy misbehaves — not structured
// logging, sinks or rotation.
package logging

import (
	"fmt"
	"log"
	"os"
	"strings"
	"sync/atomic"
)

// Level is how much a binary says about what it's doing.
type Level int32

const (
	// LevelDebug narrates every engine call, lease and poll. Loud on purpose.
	LevelDebug Level = iota
	// LevelInfo is the default: lifecycle events and outcomes.
	LevelInfo
	// LevelWarn is recoverable trouble only.
	LevelWarn
	// LevelError is failures only.
	LevelError
)

// current is the active level, read on every call so it can be set at boot
// without racing whatever is already logging.
var current atomic.Int32

// ParseLevel maps a name onto a Level, falling back to info for an empty or
// unrecognised one rather than refusing to start over a typo.
func ParseLevel(name string) Level {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "debug", "trace", "verbose":
		return LevelDebug
	case "warn", "warning":
		return LevelWarn
	case "error", "fatal":
		return LevelError
	default:
		return LevelInfo
	}
}

// SetLevel sets how much is logged from here on.
func SetLevel(level Level) {
	current.Store(int32(level))
}

// SetLevelFromEnv reads the level from WORKER_LOG_LEVEL, else LOG_LEVEL, so a
// compose file that already sets one log level for the app configures the Go
// binaries with it too, and the worker can still be turned up on its own.
func SetLevelFromEnv() Level {
	name := os.Getenv("WORKER_LOG_LEVEL")
	if name == "" {
		name = os.Getenv("LOG_LEVEL")
	}
	level := ParseLevel(name)
	SetLevel(level)
	return level
}

// Enabled reports whether level would be logged, for a caller that would have
// to do real work to build the message.
func Enabled(level Level) bool {
	return int32(level) >= current.Load()
}

// Debugf logs the detail that's only worth having when something is wrong.
func Debugf(scope, format string, args ...any) {
	emit(LevelDebug, "debug", scope, format, args...)
}

// Infof logs a lifecycle event or an outcome.
func Infof(scope, format string, args ...any) {
	emit(LevelInfo, "info", scope, format, args...)
}

// Warnf logs recoverable trouble.
func Warnf(scope, format string, args ...any) {
	emit(LevelWarn, "warn", scope, format, args...)
}

// Errorf logs a failure.
func Errorf(scope, format string, args ...any) {
	emit(LevelError, "error", scope, format, args...)
}

// emit writes one line when level passes the current threshold.
func emit(level Level, label, scope, format string, args ...any) {
	if !Enabled(level) {
		return
	}
	log.Printf("[%s] [%s] %s", label, scope, sprintf(format, args...))
}

// sprintf formats only when there's anything to substitute, so a message
// containing a literal % isn't mangled.
func sprintf(format string, args ...any) string {
	if len(args) == 0 {
		return format
	}
	return fmt.Sprintf(format, args...)
}
