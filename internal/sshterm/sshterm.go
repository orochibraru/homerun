// Package sshterm opens an interactive shell on a machine over SSH, for the
// dashboard's machine terminals: a PTY session read and written like the
// container terminal's exec stream.
package sshterm

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// dialTimeout bounds connecting and the SSH handshake.
const dialTimeout = 15 * time.Second

// Target is the machine to open a shell on and how to prove who we are.
type Target struct {
	Cols int    `json:"cols"`
	Host string `json:"host"`
	// HostKey is the key the machine presented last time, in authorized_keys
	// form. Empty trusts whatever key it presents now (the first connection).
	HostKey    string `json:"hostKey"`
	Port       int    `json:"port"`
	PrivateKey string `json:"privateKey"`
	Rows       int    `json:"rows"`
	User       string `json:"user"`
}

// ErrHostKeyChanged is returned when the machine presents a different key
// than the one recorded for it.
var ErrHostKeyChanged = errors.New("the machine's host key changed since the last connection")

// Session is an open shell: reads return its output, writes are keystrokes,
// Close ends it (the remote shell gets a hangup).
type Session struct {
	client  *ssh.Client
	session *ssh.Session
	stdin   io.WriteCloser
	stdout  io.Reader
}

// Read returns the shell's output.
func (s *Session) Read(p []byte) (int, error) { return s.stdout.Read(p) }

// Write sends keystrokes to the shell.
func (s *Session) Write(p []byte) (int, error) { return s.stdin.Write(p) }

// Close ends the shell and the connection.
func (s *Session) Close() error {
	_ = s.session.Close()
	return s.client.Close()
}

// Resize tells the remote PTY its new size.
func (s *Session) Resize(_ context.Context, height, width int) error {
	return s.session.WindowChange(height, width)
}

// Open connects to target and starts a login shell on a PTY. It returns the
// session and the host key the machine presented, in authorized_keys form,
// for the caller to record.
func Open(ctx context.Context, target Target) (*Session, string, error) {
	signer, err := ssh.ParsePrivateKey([]byte(target.PrivateKey))
	if err != nil {
		return nil, "", fmt.Errorf("couldn't read the SSH key: %w", err)
	}
	var presented string
	config := &ssh.ClientConfig{
		Auth: []ssh.AuthMethod{ssh.PublicKeys(signer)},
		HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
			presented = authorizedKey(key)
			if target.HostKey != "" && target.HostKey != presented {
				return ErrHostKeyChanged
			}
			return nil
		},
		Timeout: dialTimeout,
		User:    target.User,
	}
	port := target.Port
	if port == 0 {
		port = 22
	}
	address := net.JoinHostPort(target.Host, strconv.Itoa(port))
	dialer := net.Dialer{Timeout: dialTimeout}
	conn, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, "", fmt.Errorf("couldn't reach %s: %w", address, err)
	}
	clientConn, channels, requests, err := ssh.NewClientConn(conn, address, config)
	if err != nil {
		_ = conn.Close()
		return nil, presented, describe(err, target.User)
	}
	client := ssh.NewClient(clientConn, channels, requests)
	session, err := startShell(client, target)
	if err != nil {
		_ = client.Close()
		return nil, presented, err
	}
	return session, presented, nil
}

// startShell opens a session on client with a PTY of target's size and starts
// the user's login shell in it.
func startShell(client *ssh.Client, target Target) (*Session, error) {
	session, err := client.NewSession()
	if err != nil {
		return nil, err
	}
	cols, rows := target.Cols, target.Rows
	if cols <= 0 || rows <= 0 {
		cols, rows = 80, 24
	}
	if err := session.RequestPty("xterm-256color", rows, cols, ssh.TerminalModes{ssh.ECHO: 1}); err != nil {
		_ = session.Close()
		return nil, fmt.Errorf("the machine refused a terminal: %w", err)
	}
	stdin, err := session.StdinPipe()
	if err != nil {
		_ = session.Close()
		return nil, err
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		_ = session.Close()
		return nil, err
	}
	if err := session.Shell(); err != nil {
		_ = session.Close()
		return nil, fmt.Errorf("couldn't start a shell: %w", err)
	}
	return &Session{client: client, session: session, stdin: stdin, stdout: stdout}, nil
}

// authorizedKey renders a public key the way authorized_keys and known_hosts
// write it, without the trailing newline.
func authorizedKey(key ssh.PublicKey) string {
	return key.Type() + " " + base64.StdEncoding.EncodeToString(key.Marshal())
}

// describe turns a handshake failure into what to do about it.
func describe(err error, user string) error {
	if errors.Is(err, ErrHostKeyChanged) {
		return ErrHostKeyChanged
	}
	if strings.Contains(err.Error(), "unable to authenticate") {
		return fmt.Errorf("the machine refused Homerun's key for %q: add Homerun's public key to that user's ~/.ssh/authorized_keys", user)
	}
	return fmt.Errorf("the SSH handshake failed: %w", err)
}
