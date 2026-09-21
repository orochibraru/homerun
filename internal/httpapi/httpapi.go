// Package httpapi is the HTTP plumbing every Homerun Go service that serves a
// control surface shares: bearer auth, one log line per request, the
// error-to-500 translation and the JSON helpers. The worker's agent-mode surface
// (internal/agent) and its Docker control API (internal/worker) both route with
// chi on top of it,
// so a fix to auth or logging lands in both rather than in one of two
// hand-copied servers.
package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/orochibraru/homerun/internal/logging"
)

// scope labels every line this package logs.
const scope = "http"

// HandlerFunc is a route that reports its failures as an error, which H turns
// into a 500 carrying the message. A route that has already written its own
// answer returns nil, which Answer does for it.
type HandlerFunc func(w http.ResponseWriter, r *http.Request) error

// WriteJSON writes body as a JSON response with the given status.
func WriteJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// Answer writes a JSON response for a request the route has fully handled,
// such as a refused body, so there's no error left for H to report.
func Answer(w http.ResponseWriter, status int, body any) error {
	WriteJSON(w, status, body)
	return nil
}

// Error writes a plain `{"error": message}` body with the given status.
func Error(w http.ResponseWriter, status int, message string) error {
	return Answer(w, status, map[string]string{"error": message})
}

// H adapts an error-returning route to chi, answering a non-nil error as a 500
// whose body carries the message. The status it wrote is recorded for the
// request log; a handler that streams its own body has already written a
// status by the time it can fail, so H only logs in that case rather than
// writing a second header.
func H(handler HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		recorder, ok := w.(*StatusRecorder)
		if !ok {
			recorder = &StatusRecorder{ResponseWriter: w, Status: http.StatusOK}
			w = recorder
		}
		if err := handler(w, r); err != nil {
			recorder.Failure = err
			if recorder.Wrote {
				logging.Debugf(scope, "%s %s - stream ended early: %s", r.Method, r.URL.Path, err)
				return
			}
			WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
	}
}

// StatusRecorder remembers the status a handler wrote, and whether it has
// written anything at all, so the request log can report it and H can tell a
// failure before the first byte from one halfway through a stream.
type StatusRecorder struct {
	http.ResponseWriter
	Failure error
	Status  int
	Wrote   bool
}

// WriteHeader records status before delegating to the wrapped ResponseWriter.
func (r *StatusRecorder) WriteHeader(status int) {
	if !r.Wrote {
		r.Status = status
		r.Wrote = true
	}
	r.ResponseWriter.WriteHeader(status)
}

// Write marks the response as started, for a handler that streams a body
// without calling WriteHeader itself.
func (r *StatusRecorder) Write(chunk []byte) (int, error) {
	r.Wrote = true
	return r.ResponseWriter.Write(chunk)
}

// Flush forwards to the wrapped ResponseWriter when it supports flushing, so a
// streaming route (logs, a terminal) can push a chunk out immediately rather
// than waiting for Go's write buffer to fill.
func (r *StatusRecorder) Flush() {
	if flusher, ok := r.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

// Unwrap exposes the wrapped ResponseWriter to http.ResponseController, which
// is how a streaming route clears its write deadline.
func (r *StatusRecorder) Unwrap() http.ResponseWriter {
	return r.ResponseWriter
}

// BearerAuth refuses any request that doesn't carry the expected token as a
// Bearer credential, compared in constant time so a wrong guess can't be
// refined byte by byte from response timing.
func BearerAuth(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			presented, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
			if !ok || presented == "" || !TokensMatch(presented, token) {
				WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// TokensMatch compares two tokens in constant time.
func TokensMatch(presented, expected string) bool {
	return subtle.ConstantTimeCompare([]byte(presented), []byte(expected)) == 1
}

// RequestLog writes one line per request with the method, path, status and
// duration, so anything that reached the service and did real work leaves a
// trace. Paths in quiet are skipped: a health check polled every few seconds
// would drown out everything else.
func RequestLog(quiet ...string) func(http.Handler) http.Handler {
	skip := make(map[string]struct{}, len(quiet))
	for _, path := range quiet {
		skip[path] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, quiet := skip[r.URL.Path]; quiet {
				next.ServeHTTP(w, r)
				return
			}
			start := time.Now()
			recorder := &StatusRecorder{ResponseWriter: w, Status: http.StatusOK}
			next.ServeHTTP(recorder, r)
			elapsed := time.Since(start).Milliseconds()
			if recorder.Failure != nil {
				logging.Errorf(scope, "%s %s - %d (%dms): %s",
					r.Method, r.URL.Path, recorder.Status, elapsed, recorder.Failure)
				return
			}
			logging.Infof(scope, "%s %s - %d (%dms)", r.Method, r.URL.Path, recorder.Status, elapsed)
		})
	}
}

// NotFound answers anything that matched no route with a JSON 404, rather than
// chi's own plain-text default, so every answer from this service is JSON.
func NotFound(w http.ResponseWriter, _ *http.Request) {
	WriteJSON(w, http.StatusNotFound, map[string]string{"error": "Not found"})
}

// MethodNotAllowed answers a known path reached with the wrong method.
func MethodNotAllowed(w http.ResponseWriter, _ *http.Request) {
	WriteJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
}

// ValidationIssue is one reason a request body or query was refused, so a
// malformed request fails as a clean 400 naming the field instead of deep
// inside a docker call.
type ValidationIssue struct {
	Message string   `json:"message"`
	Path    []string `json:"path"`
}

// Invalid answers a refused request with the issues that refused it. The
// message matches what the SvelteKit API returns for the same kind of refusal
// ("Invalid request body", "Invalid query"), so a client sees one shape
// whichever side answered.
func Invalid(w http.ResponseWriter, message string, issues []ValidationIssue) error {
	return Answer(w, http.StatusBadRequest, map[string]any{"error": message, "issues": issues})
}

// DecodeJSON reads a JSON request body into target, answering a 400 itself
// when the body isn't valid JSON. It reports whether the caller should carry
// on: false means a response has already been written.
func DecodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	if err := json.NewDecoder(r.Body).Decode(target); err != nil {
		_ = Invalid(w, "Invalid request body", []ValidationIssue{{Message: "the body isn't valid JSON", Path: []string{}}})
		return false
	}
	return true
}
