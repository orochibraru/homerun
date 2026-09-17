package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// StoredConfig is what `homerun login` saves: the instance URL and a CLI-scoped API key.
type StoredConfig struct {
	APIKey  string `json:"apiKey"`
	BaseURL string `json:"baseUrl"`
}

// configDir is ~/.config/homerun, where the stored login lives.
func configDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".config", "homerun")
	}
	return filepath.Join(home, ".config", "homerun")
}

// configPath is the absolute path of the stored config file, ~/.config/homerun/config.json.
func configPath() string {
	return filepath.Join(configDir(), "config.json")
}

// readStoredConfig reads the stored base URL and API key, or nil when the file
// is missing, unparseable or lacks either field.
func readStoredConfig() *StoredConfig {
	body, err := os.ReadFile(configPath())
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

// writeStoredConfig saves the login. It contains a live API key, kept out of
// group/other read via 0600/0700, same posture as any other locally-stored
// credential.
func writeStoredConfig(config StoredConfig) error {
	if err := os.MkdirAll(configDir(), 0o700); err != nil {
		return err
	}
	body, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configPath(), append(body, '\n'), 0o600)
}

// clearStoredConfig deletes the stored config file if it exists.
func clearStoredConfig() {
	_ = os.Remove(configPath())
}
