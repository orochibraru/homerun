package sshterm_test

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"io"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"

	"github.com/orochibraru/homerun/internal/sshterm"
)

// clientKey is a PKCS#8 PEM ed25519 key, the form the app generates, and its public half.
func clientKey(t *testing.T) (string, ssh.PublicKey) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		t.Fatal(err)
	}
	sshPublic, err := ssh.NewPublicKey(public)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Bytes: der, Type: "PRIVATE KEY"})), sshPublic
}

// serve starts an SSH server that lets `allowed` in and echoes whatever its
// shell receives, and returns its host and port.
func serve(t *testing.T, allowed ssh.PublicKey) (string, int) {
	t.Helper()
	_, hostPrivate, _ := ed25519.GenerateKey(rand.Reader)
	hostSigner, err := ssh.NewSignerFromKey(hostPrivate)
	if err != nil {
		t.Fatal(err)
	}
	config := &ssh.ServerConfig{
		PublicKeyCallback: func(_ ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
			if bytes.Equal(key.Marshal(), allowed.Marshal()) {
				return nil, nil
			}
			return nil, errors.New("unknown key")
		},
	}
	config.AddHostKey(hostSigner)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go handle(conn, config)
		}
	}()
	address := listener.Addr().(*net.TCPAddr)
	return "127.0.0.1", address.Port
}

// handle runs one connection: every session channel gets its pty and shell
// requests accepted and echoes its input back.
func handle(conn net.Conn, config *ssh.ServerConfig) {
	_, channels, requests, err := ssh.NewServerConn(conn, config)
	if err != nil {
		return
	}
	go ssh.DiscardRequests(requests)
	for request := range channels {
		channel, sessionRequests, err := request.Accept()
		if err != nil {
			continue
		}
		go func() {
			for req := range sessionRequests {
				_ = req.Reply(req.Type == "pty-req" || req.Type == "shell" || req.Type == "window-change", nil)
			}
		}()
		go func() { _, _ = io.Copy(channel, channel) }()
	}
}

func TestOpenEchoesAndRemembersTheHostKey(t *testing.T) {
	private, public := clientKey(t)
	host, port := serve(t, public)
	session, hostKey, err := sshterm.Open(context.Background(), sshterm.Target{
		Host: host, Port: port, PrivateKey: private, User: "git",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hostKey, "ssh-ed25519 ") {
		t.Fatalf("host key = %q", hostKey)
	}
	if _, err := session.Write([]byte("hello")); err != nil {
		t.Fatal(err)
	}
	buffer := make([]byte, 5)
	done := make(chan error, 1)
	go func() { _, err := io.ReadFull(session, buffer); done <- err }()
	select {
	case err := <-done:
		if err != nil || string(buffer) != "hello" {
			t.Fatalf("read %q, %v", buffer, err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no echo")
	}
	if err := session.Resize(context.Background(), 40, 120); err != nil {
		t.Fatal(err)
	}
	_ = session.Close()

	again, _, err := sshterm.Open(context.Background(), sshterm.Target{
		Host: host, HostKey: hostKey, Port: port, PrivateKey: private, User: "git",
	})
	if err != nil {
		t.Fatalf("the recorded host key should be accepted: %v", err)
	}
	_ = again.Close()
}

func TestOpenRefusesAChangedHostKeyAndNamesAnUnknownClientKey(t *testing.T) {
	private, public := clientKey(t)
	host, port := serve(t, public)
	_, _, err := sshterm.Open(context.Background(), sshterm.Target{
		Host: host, HostKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOther", Port: port, PrivateKey: private, User: "git",
	})
	if !errors.Is(err, sshterm.ErrHostKeyChanged) {
		t.Fatalf("err = %v, want a changed host key", err)
	}
	stranger, _ := clientKey(t)
	_, _, err = sshterm.Open(context.Background(), sshterm.Target{
		Host: host, Port: port, PrivateKey: stranger, User: "git",
	})
	if err == nil || !strings.Contains(err.Error(), "authorized_keys") {
		t.Fatalf("err = %v, want the authorized_keys hint", err)
	}
	_, _, err = sshterm.Open(context.Background(), sshterm.Target{
		Host: host, Port: port, PrivateKey: "nope", User: "git",
	})
	if err == nil || !strings.Contains(err.Error(), "couldn't read the SSH key") {
		t.Fatalf("err = %v", err)
	}
	_, _, err = sshterm.Open(context.Background(), sshterm.Target{
		Host: host, Port: closedPort(t), PrivateKey: private, User: "git",
	})
	if err == nil || !strings.Contains(err.Error(), "couldn't reach") {
		t.Fatalf("err = %v", err)
	}
}

// closedPort is a port nothing listens on.
func closedPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port, _ := strconv.Atoi(strings.Split(listener.Addr().String(), ":")[1])
	_ = listener.Close()
	return port
}
