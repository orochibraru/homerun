package cli

import "github.com/orochibraru/homerun/internal/homerun"

// StoredConfig is what `homerun login` saves, see internal/homerun.
type StoredConfig = homerun.StoredConfig

// configPath is where the stored login lives, ~/.config/homerun/config.json.
func configPath() string {
	return homerun.ConfigPath()
}

// readStoredConfig reads the stored login, or nil when there's no usable one.
func readStoredConfig() *StoredConfig {
	return homerun.ReadStoredConfig()
}

// writeStoredConfig saves the login at mode 0600.
func writeStoredConfig(config StoredConfig) error {
	return homerun.WriteStoredConfig(config)
}

// clearStoredConfig deletes the stored login.
func clearStoredConfig() {
	homerun.ClearStoredConfig()
}
