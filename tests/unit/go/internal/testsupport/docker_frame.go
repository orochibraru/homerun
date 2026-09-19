// Package testsupport holds helpers shared by the Go test packages under
// tests/unit/go.
package testsupport

import "encoding/binary"

// DockerFrame wraps payload in Docker's multiplexed log framing for stream
// (1 stdout, 2 stderr), the way a non-TTY container's output comes back.
func DockerFrame(stream byte, payload string) []byte {
	header := make([]byte, 8)
	header[0] = stream
	binary.BigEndian.PutUint32(header[4:], uint32(len(payload)))
	return append(header, payload...)
}
