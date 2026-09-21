package httpapi

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
)

// TokenSource says where a service's bearer token came from, for the boot
// banner.
type TokenSource string

const (
	// TokenFromEnv is an explicit token read from the environment.
	TokenFromEnv TokenSource = "env"
	// TokenGenerated is a token minted on this start and persisted.
	TokenGenerated TokenSource = "generated"
	// TokenPersisted is a token read back from a previous start.
	TokenPersisted TokenSource = "persisted"
)

// ResolveToken finds the bearer token every request must present. An explicit
// token from the environment always wins. Otherwise a token is generated once
// and persisted to tokenFile, so restarting the service doesn't invalidate
// every client already connected to it. The file holds a full-access
// credential for this host's daemon, so it's written 0600 in a 0700 directory.
func ResolveToken(explicit, tokenFile string) (string, TokenSource, error) {
	if explicit != "" {
		return explicit, TokenFromEnv, nil
	}
	if existing, err := os.ReadFile(tokenFile); err == nil {
		if token := strings.TrimSpace(string(existing)); token != "" {
			return token, TokenPersisted, nil
		}
	}
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return "", "", err
	}
	token := hex.EncodeToString(buffer)
	if err := os.MkdirAll(filepath.Dir(tokenFile), 0o700); err != nil {
		return "", "", err
	}
	if err := os.WriteFile(tokenFile, []byte(token), 0o600); err != nil {
		return "", "", err
	}
	if err := os.Chmod(tokenFile, 0o600); err != nil {
		return "", "", err
	}
	return token, TokenGenerated, nil
}

// HomeDir resolves the user's home directory: HOME, else USERPROFILE
// (Windows), else "/root".
func HomeDir() string {
	if home := os.Getenv("HOME"); home != "" {
		return home
	}
	if home := os.Getenv("USERPROFILE"); home != "" {
		return home
	}
	return "/root"
}

// WorkerControlPurpose is the label the worker's Docker control API token is
// derived under, so a token minted for it can't be replayed against anything
// else derived from the same secret.
const WorkerControlPurpose = "homerun-worker-control"

// DeriveToken builds a bearer token from a secret both sides of a call
// already share, so two processes agree on it without either being told it
// and without a file to pass between them.
//
// This is what lets the app and the worker authenticate with no extra
// configuration: both derive the control-API token from AUTH_SECRET, which
// they must already agree on anyway (it's the key job specs are encrypted
// with). An explicit token still wins, for anyone who'd rather rotate the two
// independently. It's an HMAC rather than the secret itself so that a leaked
// control token doesn't hand over the key to every encrypted column.
func DeriveToken(secret, purpose string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(purpose))
	return hex.EncodeToString(mac.Sum(nil))
}
