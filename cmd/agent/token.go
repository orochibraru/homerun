package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
)

// TokenSource says where the agent's token came from, for the boot banner.
type TokenSource string

const (
	// TokenFromEnv is an explicit AGENT_TOKEN.
	TokenFromEnv TokenSource = "env"
	// TokenGenerated is a token minted on this start and persisted.
	TokenGenerated TokenSource = "generated"
	// TokenPersisted is a token read back from a previous start.
	TokenPersisted TokenSource = "persisted"
)

// resolveToken finds the bearer token every request must present. An explicit
// AGENT_TOKEN always wins. Otherwise a token is generated once and persisted
// to tokenFile, so restarting the agent doesn't invalidate every main app
// already connected to it. The file holds a full-access credential for this
// host's daemon, so it's written 0600 in a 0700 directory.
func resolveToken(explicit, tokenFile string) (string, TokenSource, error) {
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

// tokensMatch compares two tokens in constant time, so a wrong guess can't be
// refined byte by byte from response timing.
func tokensMatch(presented, expected string) bool {
	return subtle.ConstantTimeCompare([]byte(presented), []byte(expected)) == 1
}
