package dockerapi

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
)

// RemoteHost is a remote Docker daemon as a remote_host row describes it: a
// tcp:// address, with TLS when all three PEM blocks are set.
type RemoteHost struct {
	DockerHost string `json:"dockerHost"`
	TLSCA      string `json:"tlsCa"`
	TLSCert    string `json:"tlsCert"`
	TLSKey     string `json:"tlsKey"`
}

// NewRemote builds a client for a remote daemon over TCP, verifying the daemon
// against TLSCA and presenting TLSCert/TLSKey when they're all set, plain HTTP
// otherwise. The port defaults to 2375. ssh:// hosts aren't supported.
func NewRemote(host RemoteHost) (*Client, error) {
	parsed, err := url.Parse(host.DockerHost)
	if err != nil {
		return nil, fmt.Errorf("invalid Docker host %q: %w", host.DockerHost, err)
	}
	if parsed.Scheme != "tcp" {
		return nil, fmt.Errorf("the homerun worker can't reach %s hosts, only tcp://", parsed.Scheme)
	}
	port := parsed.Port()
	if port == "" {
		port = "2375"
	}
	address := net.JoinHostPort(parsed.Hostname(), port)
	if host.TLSCA == "" || host.TLSCert == "" || host.TLSKey == "" {
		return &Client{http: &http.Client{}, Base: "http://" + address}, nil
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
	return &Client{http: &http.Client{Transport: transport}, Base: "https://" + address}, nil
}
