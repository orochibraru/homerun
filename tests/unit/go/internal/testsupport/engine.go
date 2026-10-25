package testsupport

import (
	"io"
	"net/http"
	"regexp"

	"github.com/moby/moby/client"
)

var versionPrefix = regexp.MustCompile(`^/v[0-9]+\.[0-9]+/`)

// Engine fronts a fake Docker daemon the way the real one answers the typed
// SDK: it settles the SDK's version negotiation ping (a HEAD /_ping) itself and
// strips the API version from every other path, so handler routes on the
// Engine's unversioned paths.
func Engine(handler http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead && r.URL.Path == "/_ping" {
			w.Header().Set("Api-Version", client.MaxAPIVersion)
			w.WriteHeader(http.StatusOK)
			return
		}
		r.URL.Path = versionPrefix.ReplaceAllString(r.URL.Path, "/")
		handler.ServeHTTP(w, r)
	})
}

// Hijack answers an attach or an exec start the way the daemon does: it
// reads the request through, upgrades the connection, writes output as the
// process's whole output and closes it.
func Hijack(w http.ResponseWriter, r *http.Request, output []byte) {
	_, _ = io.Copy(io.Discard, r.Body)
	conn, buffered, err := http.NewResponseController(w).Hijack()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer func() { _ = conn.Close() }()
	_, _ = buffered.WriteString("HTTP/1.1 101 UPGRADED\r\nContent-Type: application/vnd.docker.raw-stream\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n")
	_, _ = buffered.Write(output)
	_ = buffered.Flush()
}
