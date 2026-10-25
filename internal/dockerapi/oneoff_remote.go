package dockerapi

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"

	"github.com/moby/moby/client"
	"go.opentelemetry.io/otel/trace/noop"
)

// RemoteHost is a remote Docker daemon as a remote_host row describes it: a
// tcp:// address, with TLS when all three PEM blocks are set, or an
// ssh://user@host[:port] address reached with the instance's SSH key and
// checked against the host key recorded for it.
type RemoteHost struct {
	DockerHost    string `json:"dockerHost"`
	SSHHostKey    string `json:"sshHostKey"`
	SSHPrivateKey string `json:"sshPrivateKey"`
	TLSCA         string `json:"tlsCa"`
	TLSCert       string `json:"tlsCert"`
	TLSKey        string `json:"tlsKey"`
}

// NewRemote builds a client for a remote daemon. Over tcp:// it verifies the
// daemon against TLSCA and presents TLSCert/TLSKey when they're all set, plain
// HTTP otherwise, the port defaulting to 2375. Over ssh:// it opens one SSH
// connection, shared by every call and reopened when it drops, and reaches the
// daemon's /var/run/docker.sock through it; the host key must already be
// recorded (see ProbeSSH).
func NewRemote(host RemoteHost) (*Client, error) {
	parsed, err := url.Parse(host.DockerHost)
	if err != nil {
		return nil, fmt.Errorf("invalid Docker host %q: %w", host.DockerHost, err)
	}
	if parsed.Scheme == "ssh" {
		if host.SSHHostKey == "" {
			return nil, fmt.Errorf("no SSH host key is recorded for %s yet", parsed.Host)
		}
		client, _, err := newRemoteSSH(parsed, host)
		return client, err
	}
	if parsed.Scheme != "tcp" {
		return nil, fmt.Errorf("the homerun worker can't reach %s hosts, only tcp:// and ssh://", parsed.Scheme)
	}
	port := parsed.Port()
	if port == "" {
		port = "2375"
	}
	daemon := client.WithHost("tcp://" + net.JoinHostPort(parsed.Hostname(), port))
	if host.TLSCA == "" || host.TLSCert == "" || host.TLSKey == "" {
		return newClient(daemon)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM([]byte(host.TLSCA)) {
		return nil, errors.New("the remote host's CA certificate isn't valid PEM")
	}
	certificate, err := tls.X509KeyPair([]byte(host.TLSCert), []byte(host.TLSKey))
	if err != nil {
		return nil, fmt.Errorf("the remote host's client certificate: %w", err)
	}
	transport := &http.Transport{TLSClientConfig: &tls.Config{
		Certificates: []tls.Certificate{certificate},
		MinVersion:   tls.VersionTLS12,
		RootCAs:      roots,
	}}
	return newClient(client.WithHTTPClient(&http.Client{Transport: transport}), daemon)
}

// newClient builds a client from SDK options. The SDK's own per-request HTTP
// spans are switched off: a job's trace records its stages, not every Engine
// call under them.
func newClient(options ...client.Opt) (*Client, error) {
	api, err := client.New(append(options, client.WithTraceProvider(noop.NewTracerProvider()))...)
	if err != nil {
		return nil, err
	}
	return &Client{api: api}, nil
}
