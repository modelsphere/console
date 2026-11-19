package plugincli

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

// Runner invokes Helm and kubectl with the selected cluster context.
type Runner struct {
	HelmPath       string
	KubectlPath    string
	Kubeconfig     string
	Context        string
	LogWriter      io.Writer
	Verbosity      int
	CommandTimeout time.Duration

	// secretMetadata replaces the client built from Kubeconfig in tests.
	secretMetadata metadataLister
}

var sensitiveLogPattern = regexp.MustCompile(`(?i)((?:authorization|token|password|secret|api[-_]?key)[[:space:]]*[:=][[:space:]]*)([^[:space:],]+)`)

// HelmRelease is the subset of Helm release metadata needed by lifecycle commands.
type HelmRelease struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Status    string `json:"status"`
	Chart     string `json:"chart"`
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
	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = r.stderrWriter(&stderr)
	started := time.Now()
	r.log(1, "starting %s", binary)
	r.log(2, "command: %s", formatCommand(binary, commandArgs))
	err := r.waitCommand(commandContext, command, binary, started)
	if err == nil {
		r.log(2, "completed %s in %s", binary, time.Since(started).Round(time.Millisecond))
		if r.Verbosity >= 6 {
			r.log(6, "output: stdout=%d bytes stderr=%d bytes", stdout.Len(), stderr.Len())
		}
		return stdout.Bytes(), nil
	}
	detail := strings.TrimSpace(strings.TrimSpace(stderr.String()) + " " + strings.TrimSpace(stdout.String()))
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

func (r Runner) waitCommand(commandContext context.Context, command *exec.Cmd, binary string, started time.Time) error {
	done := make(chan error, 1)
	go func() { done <- command.Run() }()
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case err := <-done:
			return err
		case <-ticker.C:
			r.log(1, "%s still running after %s", binary, time.Since(started).Round(time.Second))
		case <-commandContext.Done():
			return <-done
		}
	}
}

func (r Runner) stderrWriter(buffer *bytes.Buffer) io.Writer {
	if r.Verbosity < 4 || r.LogWriter == nil {
		return buffer
	}
	return io.MultiWriter(buffer, redactingWriter{writer: r.LogWriter})
}

func (r Runner) log(level int, format string, args ...any) {
	if r.Verbosity < level || r.LogWriter == nil {
		return
	}
	_, _ = fmt.Fprintf(r.LogWriter, "modelsphere[v=%d] %s\n", level, fmt.Sprintf(format, args...))
}

func formatCommand(binary string, args []string) string {
	parts := append([]string{binary}, redactCommandArgs(args)...)
	return strings.Join(parts, " ")
}

func redactCommandArgs(args []string) []string {
	redacted := make([]string, len(args))
	copy(redacted, args)
	for index := range redacted {
		if isSensitiveFlag(redacted[index]) && index+1 < len(redacted) {
			redacted[index+1] = "<redacted>"
		}
		for _, flag := range []string{"--set=", "--set-string=", "--set-file="} {
			if strings.HasPrefix(redacted[index], flag) {
				redacted[index] = flag + "<redacted>"
			}
		}
	}
	return redacted
}

func isSensitiveFlag(value string) bool {
	for _, flag := range []string{"--password", "--token", "--secret", "--api-key", "--apikey", "--authorization"} {
		if value == flag {
			return true
		}
	}
	return false
}

type redactingWriter struct {
	writer io.Writer
}

func (writer redactingWriter) Write(data []byte) (int, error) {
	redacted := sensitiveLogPattern.ReplaceAllString(string(data), "$1<redacted>")
	_, err := writer.writer.Write([]byte(redacted))
	return len(data), err
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

// ListReleasesInNamespace returns all Helm releases in one namespace.
func (r Runner) ListReleasesInNamespace(ctx context.Context, namespace string) ([]HelmRelease, error) {
	if namespace == "" {
		return nil, fmt.Errorf("Helm release namespace is required")
	}
	return r.listReleases(ctx, "--namespace", namespace)
}

func (r Runner) listReleases(ctx context.Context, scope ...string) ([]HelmRelease, error) {
	args := []string{"list"}
	args = append(args, scope...)
	args = append(args, "--all", "--output", "json")
	data, err := r.helm(ctx, args...)
	if err != nil {
		return nil, fmt.Errorf("list Helm releases: %w", err)
	}
	var releases []HelmRelease
	if err := json.Unmarshal(data, &releases); err != nil {
		return nil, fmt.Errorf("parse Helm release list: %w", err)
	}
	return releases, nil
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

func (r Runner) Uninstall(ctx context.Context, release, namespace string, wait bool, timeout time.Duration) error {
	args := []string{"uninstall", release, "--namespace", namespace}
	if wait {
		args = append(args, "--wait", "--timeout", timeout.String())
	}
	_, err := r.helm(ctx, args...)
	return err
}

// runHelmWait waits for the release and, on failure, rolls the release back so a
// timed-out install does not leave it pending and block the next attempt.
func (r Runner) runHelmWait(ctx context.Context, args []string, wait bool, timeout time.Duration) error {
	if wait {
		args = append(args, "--wait", "--atomic", "--timeout", timeout.String())
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
