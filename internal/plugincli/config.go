package plugincli

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// Settings contains non-secret cluster and Console release defaults.
type Settings struct {
	Kubeconfig string          `yaml:"kubeconfig,omitempty"`
	Context    string          `yaml:"context,omitempty"`
	Console    ConsoleSettings `yaml:"console,omitempty"`
}

// ConsoleSettings identifies the existing Console Helm release.
type ConsoleSettings struct {
	Release      string `yaml:"release,omitempty"`
	Namespace    string `yaml:"namespace,omitempty"`
	Chart        string `yaml:"chart,omitempty"`
	ChartVersion string `yaml:"chartVersion,omitempty"`
	URL          string `yaml:"url,omitempty"`
}

func loadSettings(path string) (Settings, error) {
	if path == "" {
		path = os.Getenv("MODELSPHERE_CONFIG")
	}
	if path == "" {
		configDir, err := os.UserConfigDir()
		if err == nil {
			path = filepath.Join(configDir, "modelsphere", "config.yaml")
		}
	}
	if path == "" {
		return Settings{}, nil
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Settings{}, nil
	}
	if err != nil {
		return Settings{}, fmt.Errorf("read ModelSphere config %s: %w", path, err)
	}
	var settings Settings
	if err := yaml.Unmarshal(data, &settings); err != nil {
		return Settings{}, fmt.Errorf("parse ModelSphere config %s: %w", path, err)
	}
	return settings, nil
}
