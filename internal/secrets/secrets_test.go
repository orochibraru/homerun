package secrets

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

type parityFixture struct {
	AuthSecret string `json:"authSecret"`
	FromGo     string `json:"fromGo"`
	FromTS     string `json:"fromTs"`
	Plaintext  string `json:"plaintext"`
}

func loadFixture(t *testing.T) parityFixture {
	t.Helper()
	raw, err := os.ReadFile("testdata/parity.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture parityFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}

func mustBox(t *testing.T, secret string) *Box {
	t.Helper()
	box, err := New(secret)
	if err != nil {
		t.Fatal(err)
	}
	return box
}

func TestRoundTrip(t *testing.T) {
	box := mustBox(t, "a-secret")
	for _, plaintext := range []string{"hunter2", "", "日本語 🔐"} {
		sealed, err := box.Encrypt(plaintext)
		if err != nil {
			t.Fatal(err)
		}
		got, err := box.Decrypt(sealed)
		if err != nil || got != plaintext {
			t.Errorf("round trip of %q gave %q, %v", plaintext, got, err)
		}
	}
	first, _ := box.Encrypt("same")
	second, _ := box.Encrypt("same")
	if first == second {
		t.Error("a fresh IV means two encryptions never match")
	}
}

func TestDecryptsTheTypeScriptFixture(t *testing.T) {
	fixture := loadFixture(t)
	box := mustBox(t, fixture.AuthSecret)
	for name, sealed := range map[string]string{"ts": fixture.FromTS, "go": fixture.FromGo} {
		got, err := box.Decrypt(sealed)
		if err != nil || got != fixture.Plaintext {
			t.Errorf("%s fixture decrypted to %q, %v", name, got, err)
		}
	}
}

func TestRejectsMalformedAndTampered(t *testing.T) {
	box := mustBox(t, "a-secret")
	for _, bad := range []string{"", "not-encrypted", "a.b", "a.b.c.d", "!!!.!!!.!!!"} {
		if _, err := box.Decrypt(bad); err == nil {
			t.Errorf("%q should not decrypt", bad)
		}
	}
	sealed, _ := box.Encrypt("hunter2")
	parts := strings.Split(sealed, ".")
	ciphertext, _ := base64.StdEncoding.DecodeString(parts[2])
	ciphertext[0] ^= 0xff
	parts[2] = base64.StdEncoding.EncodeToString(ciphertext)
	if _, err := box.Decrypt(strings.Join(parts, ".")); err == nil {
		t.Error("a tampered ciphertext must not decrypt")
	}
	if _, err := mustBox(t, "another-secret").Decrypt(sealed); err == nil {
		t.Error("the wrong key must not decrypt")
	}
}

func TestAuthSecretFromEnv(t *testing.T) {
	t.Setenv("AUTH_SECRET", " ")
	t.Setenv("BETTER_AUTH_SECRET", "from-better-auth")
	if got := AuthSecretFromEnv(); got != "from-better-auth" {
		t.Errorf("got %q", got)
	}
	t.Setenv("BETTER_AUTH_SECRET", "")
	if got := AuthSecretFromEnv(); got != "default-secret" {
		t.Errorf("got %q", got)
	}
	t.Setenv("AUTH_SECRET", "primary")
	if got := AuthSecretFromEnv(); got != "primary" {
		t.Errorf("got %q", got)
	}
}
