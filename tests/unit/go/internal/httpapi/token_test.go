package httpapi_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/orochibraru/homerun/internal/httpapi"
)

func TestResolveTokenExplicitWins(t *testing.T) {
	file := filepath.Join(t.TempDir(), "token")
	token, source, err := httpapi.ResolveToken("from-env", file)
	if err != nil || token != "from-env" || source != httpapi.TokenFromEnv {
		t.Fatalf("got %q %q %v", token, source, err)
	}
	if _, err := os.Stat(file); err == nil {
		t.Error("an explicit token must not touch the filesystem")
	}
}

func TestResolveTokenGeneratesPersistsAndReuses(t *testing.T) {
	file := filepath.Join(t.TempDir(), "nested", "token")

	first, source, err := httpapi.ResolveToken("", file)
	if err != nil || source != httpapi.TokenGenerated || len(first) != 64 {
		t.Fatalf("want a fresh 32-byte hex token, got %q %q %v", first, source, err)
	}
	info, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("the token is a full-access credential, want 0600, got %o", info.Mode().Perm())
	}
	if dir, _ := os.Stat(filepath.Dir(file)); dir.Mode().Perm() != 0o700 {
		t.Errorf("its directory should be 0700, got %o", dir.Mode().Perm())
	}

	second, source, err := httpapi.ResolveToken("", file)
	if err != nil || source != httpapi.TokenPersisted || second != first {
		t.Errorf("a restart must reuse the persisted token, got %q %q %v", second, source, err)
	}
}

func TestResolveTokenRegeneratesAWhitespaceFile(t *testing.T) {
	file := filepath.Join(t.TempDir(), "token")
	if err := os.WriteFile(file, []byte("  \n"), 0o600); err != nil {
		t.Fatal(err)
	}
	token, source, err := httpapi.ResolveToken("", file)
	if err != nil || source != httpapi.TokenGenerated || token == "" {
		t.Errorf("a blank file counts as absent, got %q %q %v", token, source, err)
	}
}

func TestResolveTokenTrimsAPersistedToken(t *testing.T) {
	file := filepath.Join(t.TempDir(), "token")
	if err := os.WriteFile(file, []byte("  abc123\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	token, source, err := httpapi.ResolveToken("", file)
	if err != nil || token != "abc123" || source != httpapi.TokenPersisted {
		t.Errorf("got %q %q %v", token, source, err)
	}
}

func TestResolveTokenReportsAnUnwritableLocation(t *testing.T) {
	blocker := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(blocker, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := httpapi.ResolveToken("", filepath.Join(blocker, "token")); err == nil {
		t.Error("a token that can't be persisted must fail startup, not be lost on restart")
	}
}

func TestTokensMatch(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"same", "same", true},
		{"same", "Same", false},
		{"short", "longer", false},
		{"", "", true},
	}
	for _, testCase := range cases {
		if got := httpapi.TokensMatch(testCase.a, testCase.b); got != testCase.want {
			t.Errorf("%q vs %q: want %t", testCase.a, testCase.b, testCase.want)
		}
	}
}

func TestHomeDirFallbacks(t *testing.T) {
	t.Setenv("HOME", "")
	t.Setenv("USERPROFILE", "/users/win")
	if got := httpapi.HomeDir(); got != "/users/win" {
		t.Errorf("got %q", got)
	}
	t.Setenv("USERPROFILE", "")
	if got := httpapi.HomeDir(); got != "/root" {
		t.Errorf("got %q", got)
	}
}
