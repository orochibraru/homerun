package testsupport

import (
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// ServeUnixSocket serves handler on a fresh unix socket, closed and removed
// when the test ends, and returns the socket's path. The socket lives under
// /tmp because macOS caps socket paths well below t.TempDir()'s length.
func ServeUnixSocket(t *testing.T, handler http.Handler) string {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "hr")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	socket := filepath.Join(dir, "d.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewUnstartedServer(handler)
	server.Listener = listener
	server.Start()
	t.Cleanup(server.Close)
	return socket
}
