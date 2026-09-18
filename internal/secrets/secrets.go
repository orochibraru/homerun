// Package secrets encrypts and decrypts values in exactly the format of the
// app's src/lib/services/secrets.ts: AES-256-GCM keyed by
// scrypt(AUTH_SECRET, "homerun-registry-secrets"), stored as
// base64(iv) + "." + base64(tag) + "." + base64(ciphertext).
package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"os"
	"strings"

	"golang.org/x/crypto/scrypt"
)

const (
	salt      = "homerun-registry-secrets"
	ivLength  = 12
	tagLength = 16
)

// ErrMalformed is returned for a stored value that isn't three base64 parts.
var ErrMalformed = errors.New("secrets: malformed ciphertext")

// Box encrypts and decrypts with one derived key.
type Box struct {
	aead cipher.AEAD
}

// AuthSecretFromEnv resolves the auth secret the same way the app's config
// does: AUTH_SECRET, else BETTER_AUTH_SECRET, else the "default-secret"
// placeholder.
func AuthSecretFromEnv() string {
	for _, key := range []string{"AUTH_SECRET", "BETTER_AUTH_SECRET"} {
		if value := os.Getenv(key); strings.TrimSpace(value) != "" {
			return value
		}
	}
	return "default-secret"
}

// New derives the key from authSecret with Node's scryptSync defaults
// (N=16384, r=8, p=1).
func New(authSecret string) (*Box, error) {
	key, err := scrypt.Key([]byte(authSecret), []byte(salt), 16384, 8, 1, 32)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCMWithNonceSize(block, ivLength)
	if err != nil {
		return nil, err
	}
	return &Box{aead: aead}, nil
}

// Encrypt seals plaintext with a fresh random IV.
func (b *Box) Encrypt(plaintext string) (string, error) {
	iv := make([]byte, ivLength)
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}
	sealed := b.aead.Seal(nil, iv, []byte(plaintext), nil)
	ciphertext, tag := sealed[:len(sealed)-tagLength], sealed[len(sealed)-tagLength:]
	enc := base64.StdEncoding.EncodeToString
	return enc(iv) + "." + enc(tag) + "." + enc(ciphertext), nil
}

// Decrypt reverses Encrypt, or the TS encryptSecret().
func (b *Box) Decrypt(stored string) (string, error) {
	parts := strings.Split(stored, ".")
	if len(parts) != 3 {
		return "", ErrMalformed
	}
	decoded := make([][]byte, 3)
	for i, part := range parts {
		value, err := base64.StdEncoding.DecodeString(part)
		if err != nil {
			return "", ErrMalformed
		}
		decoded[i] = value
	}
	iv, tag, ciphertext := decoded[0], decoded[1], decoded[2]
	if len(iv) != ivLength || len(tag) != tagLength {
		return "", ErrMalformed
	}
	plaintext, err := b.aead.Open(nil, iv, append(ciphertext, tag...), nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}
