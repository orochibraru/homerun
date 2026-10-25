package dockerapi

import (
	"context"
	"errors"
	"io"

	"github.com/moby/moby/client"
)

// ExecConfig is an interactive exec: a command to run inside a running
// container, with a TTY when the caller wants a shell rather than a pipe, and
// stdin attached when it wants to type into it.
type ExecConfig struct {
	Cmd   []string
	Stdin bool
	Tty   bool
}

// HijackedStream is a duplex connection to a running exec or an attached
// container. Reads take the process's output, writes go to its stdin, and
// Close ends it. When there's no TTY the read side is frame-multiplexed, so
// the caller demuxes it; with a TTY it's the raw terminal byte stream.
type HijackedStream struct {
	response client.HijackedResponse
	release  func() bool
}

// newHijackedStream wraps a hijacked response, closing it as soon as ctx ends
// so a reader blocked on it is released.
func newHijackedStream(ctx context.Context, response client.HijackedResponse) *HijackedStream {
	stream := &HijackedStream{response: response}
	stream.release = context.AfterFunc(ctx, func() { response.Close() })
	return stream
}

// Read takes the next bytes of the process's output.
func (s *HijackedStream) Read(buffer []byte) (int, error) {
	return s.response.Reader.Read(buffer)
}

// Write sends bytes to the process's stdin.
func (s *HijackedStream) Write(chunk []byte) (int, error) {
	return s.response.Conn.Write(chunk)
}

// CloseWrite half-closes the connection, which the daemon takes as the end of
// the process's stdin while its output keeps coming back.
func (s *HijackedStream) CloseWrite() error {
	if _, ok := s.response.Conn.(client.CloseWriter); !ok {
		return errors.New("dockerapi: this connection can't be half-closed")
	}
	return s.response.CloseWrite()
}

// Close ends the connection, which the daemon takes as the end of the
// process's stdin and tears an exec down.
func (s *HijackedStream) Close() error {
	s.release()
	s.response.Close()
	return nil
}

// CreateExec creates an exec instance inside a running container and returns
// its id, without starting it.
func (c *Client) CreateExec(ctx context.Context, container string, config ExecConfig) (string, error) {
	created, err := control(ctx, ControlTimeout, "exec in "+shortID(container), container, func(ctx context.Context) (client.ExecCreateResult, error) {
		return c.api.ExecCreate(ctx, container, client.ExecCreateOptions{
			AttachStderr: true,
			AttachStdin:  config.Stdin,
			AttachStdout: true,
			Cmd:          config.Cmd,
			TTY:          config.Tty,
		})
	})
	return created.ID, err
}

// StartExecHijacked starts an exec and hands back its duplex stream, which
// stays open until the caller closes it or ctx ends. Only the handshake is
// bounded by ControlTimeout.
func (c *Client) StartExecHijacked(ctx context.Context, execID string, tty bool) (*HijackedStream, error) {
	response, err := control(ctx, ControlTimeout, "start exec "+shortID(execID), "", func(ctx context.Context) (client.ExecAttachResult, error) {
		return c.api.ExecAttach(ctx, execID, client.ExecAttachOptions{TTY: tty})
	})
	if err != nil {
		return nil, err
	}
	return newHijackedStream(ctx, response.HijackedResponse), nil
}

// InspectExec reads a finished exec's exit code.
func (c *Client) InspectExec(ctx context.Context, execID string) (int, error) {
	inspected, err := control(ctx, ControlTimeout, "inspect exec "+shortID(execID), "", func(ctx context.Context) (client.ExecInspectResult, error) {
		return c.api.ExecInspect(ctx, execID, client.ExecInspectOptions{})
	})
	return inspected.ExitCode, err
}

// ResizeExec tells the daemon the terminal's new size, so a shell running
// under a TTY rewraps its output instead of assuming 80x24 forever.
func (c *Client) ResizeExec(ctx context.Context, execID string, height, width int) error {
	return discard(control(ctx, ControlTimeout, "resize exec "+shortID(execID), "", func(ctx context.Context) (client.ExecResizeResult, error) {
		return c.api.ExecResize(ctx, execID, client.ExecResizeOptions{Height: uint(max(height, 0)), Width: uint(max(width, 0))})
	}))
}

// attach hijacks a container's stdout and stderr, and its stdin when stdin is
// set, for as long as ctx lasts. Only the handshake is bounded by
// ControlTimeout.
func (c *Client) attach(ctx context.Context, id string, stdin bool) (*HijackedStream, error) {
	response, err := control(ctx, ControlTimeout, "attach "+shortID(id), id, func(ctx context.Context) (client.ContainerAttachResult, error) {
		return c.api.ContainerAttach(ctx, id, client.ContainerAttachOptions{
			Stderr: true,
			Stdin:  stdin,
			Stdout: true,
			Stream: true,
		})
	})
	if err != nil {
		return nil, err
	}
	return newHijackedStream(ctx, response.HijackedResponse), nil
}

var _ io.ReadWriteCloser = (*HijackedStream)(nil)
