// Package homerun is a client for a Homerun instance's REST API (/api/v1), and
// the login `homerun login` stores for it.
package homerun

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// Config is a resolved instance URL and API key, whatever they came from.
type Config struct {
	APIKey  string
	BaseURL string
}

// StoredConfig is what `homerun login` saves: the instance URL and a
// CLI-scoped API key.
type StoredConfig struct {
	APIKey  string `json:"apiKey"`
	BaseURL string `json:"baseUrl"`
}

// ConfigDir is ~/.config/homerun, where the stored login lives. HOME is read
// on every call, so tests can point it at a scratch directory with t.Setenv.
func ConfigDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".config", "homerun")
	}
	return filepath.Join(home, ".config", "homerun")
}

// ConfigPath is the absolute path of the stored login, ~/.config/homerun/config.json.
func ConfigPath() string {
	return filepath.Join(ConfigDir(), "config.json")
}

// ReadStoredConfig reads the stored login, or nil when the file is missing,
// unparseable or lacks either field.
func ReadStoredConfig() *StoredConfig {
	body, err := os.ReadFile(ConfigPath())
	if err != nil {
		return nil
	}
	var stored StoredConfig
	if err := json.Unmarshal(body, &stored); err != nil {
		return nil
	}
	if stored.APIKey == "" || stored.BaseURL == "" {
		return nil
	}
	return &stored
}

// WriteStoredConfig saves the login. It holds a live API key, so the file is
// 0600 in a 0700 directory, the same posture as any other local credential.
func WriteStoredConfig(config StoredConfig) error {
	if err := os.MkdirAll(ConfigDir(), 0o700); err != nil {
		return err
	}
	body, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(ConfigPath(), append(body, '\n'), 0o600)
}

// ClearStoredConfig deletes the stored login if there is one.
func ClearStoredConfig() {
	_ = os.Remove(ConfigPath())
}

// ResolveConfig resolves in order: explicit flag values, then the
// HOMERUN_BASE_URL/HOMERUN_API_KEY env vars, then the stored login. Returns nil
// rather than failing when either piece is still missing, which callers treat
// as "not logged in".
func ResolveConfig(flagBaseURL, flagAPIKey string) *Config {
	baseURL := firstNonEmpty(flagBaseURL, os.Getenv("HOMERUN_BASE_URL"))
	apiKey := firstNonEmpty(flagAPIKey, os.Getenv("HOMERUN_API_KEY"))

	if baseURL == "" || apiKey == "" {
		if stored := ReadStoredConfig(); stored != nil {
			baseURL = firstNonEmpty(baseURL, stored.BaseURL)
			apiKey = firstNonEmpty(apiKey, stored.APIKey)
		}
	}

	if baseURL == "" || apiKey == "" {
		return nil
	}
	return &Config{APIKey: apiKey, BaseURL: strings.TrimRight(baseURL, "/")}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
