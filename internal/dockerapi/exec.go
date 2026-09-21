package dockerapi

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
)

// ExecConfig is an interactive exec: a command to run inside a running
// container, with a TTY when the caller wants a shell rather than a pipe, and
// stdin attached when it wants to type into it.
type ExecConfig struct {
	Cmd   []string
	Stdin bool
	Tty   bool
}

// HijackedStream is a duplex connection to a running exec. Reads take the
// process's output, writes go to its stdin, and Close ends it. When Tty was
// false the read side is still frame-multiplexed, so the caller demuxes it;
// with a TTY it's the raw terminal byte stream.
type HijackedStream struct {
	conn   net.Conn
	reader io.Reader
}

// Read takes the next bytes of the exec's output.
func (s *HijackedStream) Read(buffer []byte) (int, error) {
	return s.reader.Read(buffer)
}

// Write sends bytes to the exec's stdin.
func (s *HijackedStream) Write(chunk []byte) (int, error) {
	return s.conn.Write(chunk)
}

// Close ends the exec's connection, which the daemon takes as the end of its
// stdin and tears the process down.
func (s *HijackedStream) Close() error {
	return s.conn.Close()
}

// CreateExec creates an exec instance inside a running container and returns
// its id, without starting it.
func (c *Client) CreateExec(ctx context.Context, container string, config ExecConfig) (string, error) {
	body := map[string]any{
		"AttachStderr": true,
		"AttachStdin":  config.Stdin,
		"AttachStdout": true,
		"Cmd":          config.Cmd,
		"Tty":          config.Tty,
	}
	var created struct {
		ID string `json:"Id"`
	}
	if err := c.decode(ctx, http.MethodPost, "/containers/"+container+"/exec", nil, body, &created); err != nil {
		return "", err
	}
	return created.ID, nil
}

// StartExecHijacked starts an exec and hands back its duplex stream.
//
// This is the connection upgrade the Engine answers with 101, which Go's own
// http.Client won't hand back as a socket, so the request goes out over a raw
// connection and the response header block is read off it by hand. The same
// step had to be hand-rolled in the TypeScript app too, but for a worse
// reason: dockerode's hijack never resolved under Bun's node:http layer. Here
// it's just what the Engine's protocol asks for.
func (c *Client) StartExecHijacked(ctx context.Context, execID string, tty bool) (*HijackedStream, error) {
	body, err := json.Marshal(map[string]any{"Detach": false, "Tty": tty})
	if err != nil {
		return nil, err
	}
	return c.hijack(ctx, "/exec/"+execID+"/start", nil, body)
}

// InspectExec reads a finished exec's exit code.
func (c *Client) InspectExec(ctx context.Context, execID string) (int, error) {
	var inspected struct {
		ExitCode int `json:"ExitCode"`
	}
	if err := c.decode(ctx, http.MethodGet, "/exec/"+execID+"/json", nil, nil, &inspected); err != nil {
		return 0, err
	}
	return inspected.ExitCode, nil
}

// ResizeExec tells the daemon the terminal's new size, so a shell running
// under a TTY rewraps its output instead of assuming 80x24 forever.
func (c *Client) ResizeExec(ctx context.Context, execID string, height, width int) error {
	return c.Call(ctx, http.MethodPost, "/exec/"+execID+"/resize",
		url.Values{"h": {fmt.Sprint(height)}, "w": {fmt.Sprint(width)}}, nil)
}

// hijack sends one request over a raw connection and returns the connection as
// a duplex stream once the daemon has answered 101 (or 200, which it uses when
// the transport needs no upgrade). Anything else comes back as an APIError
// carrying the daemon's own message, with the connection closed.
func (c *Client) hijack(ctx context.Context, path string, query url.Values, body []byte) (*HijackedStream, error) {
	if c.dial == nil {
		return nil, errors.New("dockerapi: this client can't open a hijacked stream")
	}
	conn, err := c.dial(ctx)
	if err != nil {
		return nil, err
	}
	endpoint := c.Base + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, nil)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	request.Header.Set("Connection", "Upgrade")
	request.Header.Set("Upgrade", "tcp")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
		request.Body = io.NopCloser(bytes.NewReader(body))
		request.ContentLength = int64(len(body))
	}
	if err := request.Write(conn); err != nil {
		_ = conn.Close()
		return nil, err
	}
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, request)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	if response.StatusCode != http.StatusSwitchingProtocols && response.StatusCode != http.StatusOK {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		_ = conn.Close()
		return nil, &APIError{Message: decodeMessage(message), Status: response.StatusCode}
	}
	return &HijackedStream{conn: conn, reader: reader}, nil
}

// decodeMessage pulls the daemon's human-readable message out of an error
// body, falling back to the raw body when it isn't the usual JSON shape.
func decodeMessage(raw []byte) string {
	var decoded struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(raw, &decoded); err == nil && decoded.Message != "" {
		return decoded.Message
	}
	return string(raw)
}
