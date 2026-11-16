package plugincli

import (
	"os"
	"path/filepath"
	"testing"
)

func TestConfigurationSurvivesDirectoryChange(t *testing.T) {
	directory := t.TempDir()
	configPath := filepath.Join(directory, "config.yaml")
	if err := os.WriteFile(configPath, []byte("console:\n  release: modelsphere-console\n  namespace: console-system\ncustom: preserved\n"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MODELSPHERE_CONFIG", configPath)
	t.Chdir(directory)
	t.Chdir(t.TempDir())
	settings, err := loadSettings("")
	if err != nil {
		t.Fatal(err)
	}
	if settings.Console.Release != "modelsphere-console" || settings.Console.Namespace != "console-system" {
		t.Fatal("existing Console settings were lost")
	}
}
