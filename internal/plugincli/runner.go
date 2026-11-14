package plugincli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os/exec"
	"strings"
	"time"
)

// Runner invokes Helm and kubectl with the selected cluster context.
type Runner struct {
	HelmPath       string
	KubectlPath    string
	Kubeconfig     string
	Context        string
	CommandTimeout time.Duration
}

func (r Runner) helm(ctx context.Context, args ...string) ([]byte, error) {
	return r.run(ctx, r.HelmPath, r.helmFlags(), args...)
}

func (r Runner) kubectl(ctx context.Context, args ...string) ([]byte, error) {
	return r.run(ctx, r.KubectlPath, r.kubectlFlags(), args...)
}

func (r Runner) run(ctx context.Context, binary string, globalArgs []string, args ...string) ([]byte, error) {
	if binary == "" {
		return nil, fmt.Errorf("command path is empty")
	}
	if r.CommandTimeout <= 0 {
		return nil, fmt.Errorf("command timeout must be positive")
	}
	commandContext, cancel := context.WithTimeout(ctx, r.CommandTimeout)
	defer cancel()
	commandArgs := append(append([]string(nil), globalArgs...), args...)
	command := exec.CommandContext(commandContext, binary, commandArgs...)
	output, err := command.CombinedOutput()
	if err == nil {
		return output, nil
	}
	detail := strings.TrimSpace(string(output))
	if len(detail) > 4096 {
		detail = detail[:4096] + "..."
	}
	if commandContext.Err() != nil {
		return nil, fmt.Errorf("%s timed out: %w", binary, commandContext.Err())
	}
	if detail == "" {
		return nil, fmt.Errorf("%s failed: %w", binary, err)
	}
	return nil, fmt.Errorf("%s failed: %w: %s", binary, err, detail)
}

func (r Runner) helmFlags() []string {
	flags := make([]string, 0, 4)
	if r.Kubeconfig != "" {
		flags = append(flags, "--kubeconfig", r.Kubeconfig)
	}
	if r.Context != "" {
		flags = append(flags, "--kube-context", r.Context)
	}
	return flags
}

func (r Runner) kubectlFlags() []string {
	flags := make([]string, 0, 4)
	if r.Kubeconfig != "" {
		flags = append(flags, "--kubeconfig", r.Kubeconfig)
	}
	if r.Context != "" {
		flags = append(flags, "--context", r.Context)
	}
	return flags
}

func (r Runner) GetValues(ctx context.Context, release, namespace string) ([]byte, error) {
	return r.helm(ctx, "get", "values", release, "--namespace", namespace, "--all", "--output", "yaml")
}

func (r Runner) Lint(ctx context.Context, chart string) error {
	_, err := r.helm(ctx, "lint", chart, "--strict")
	return err
}

func (r Runner) Package(ctx context.Context, chart, destination string) error {
	_, err := r.helm(ctx, "package", chart, "--destination", destination)
	return err
}

func (r Runner) UpgradePlugin(ctx context.Context, release, chart, namespace string, values []string, wait bool, timeout time.Duration) error {
	args := []string{"upgrade", "--install", release, chart, "--namespace", namespace, "--create-namespace"}
	args = appendValues(args, values)
	return r.runHelmWait(ctx, args, wait, timeout)
}

func (r Runner) UpgradeConsole(ctx context.Context, release, chart, namespace, chartVersion, patch string, wait bool, timeout time.Duration) error {
	args := []string{"upgrade", release, chart, "--namespace", namespace, "--reuse-values", "--values", patch}
	if chartVersion != "" {
		args = append(args, "--version", chartVersion)
	}
	return r.runHelmWait(ctx, args, wait, timeout)
}

func (r Runner) Uninstall(ctx context.Context, release, namespace string, wait bool, timeout time.Duration) error {
	args := []string{"uninstall", release, "--namespace", namespace}
	if wait {
		args = append(args, "--wait", "--timeout", timeout.String())
	}
	_, err := r.helm(ctx, args...)
	return err
}

func (r Runner) ServiceExists(ctx context.Context, name, namespace string) error {
	_, err := r.kubectl(ctx, "get", "service", name, "--namespace", namespace, "--output", "name")
	return err
}

func (r Runner) PluginIndex(ctx context.Context, endpoint, pluginID string) (bool, error) {
	base, err := url.Parse(strings.TrimRight(endpoint, "/"))
	if err != nil || base.Scheme == "" || base.Host == "" || base.User != nil {
		return false, fmt.Errorf("console URL must be an absolute URL without credentials")
	}
	indexURL, err := url.JoinPath(base.String(), "plugins/index.json")
	if err != nil {
		return false, fmt.Errorf("build Console plugin index URL: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, indexURL, nil)
	if err != nil {
		return false, fmt.Errorf("create Console plugin index request: %w", err)
	}
	client := &http.Client{Timeout: r.CommandTimeout}
	response, err := client.Do(request)
	if err != nil {
		return false, fmt.Errorf("read Console plugin index: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return false, fmt.Errorf("Console plugin index returned HTTP %d", response.StatusCode)
	}
	var plugins []struct {
		ID string `json:"id"`
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 1<<20))
	if err := decoder.Decode(&plugins); err != nil {
		return false, fmt.Errorf("decode Console plugin index: %w", err)
	}
	for _, plugin := range plugins {
		if plugin.ID == pluginID {
			return true, nil
		}
	}
	return false, nil
}

func (r Runner) runHelmWait(ctx context.Context, args []string, wait bool, timeout time.Duration) error {
	if wait {
		args = append(args, "--wait", "--timeout", timeout.String())
	}
	_, err := r.helm(ctx, args...)
	return err
}

func appendValues(args, values []string) []string {
	for _, value := range values {
		args = append(args, "--values", value)
	}
	return args
}
