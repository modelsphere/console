package plugincli

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"github.com/modelsphere/console/internal/config"
	"github.com/modelsphere/console/internal/pluginpackage"
	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

// Options contains process-wide CLI settings and command dependencies.
type Options struct {
	ConfigPath  string
	Kubeconfig  string
	Context     string
	HelmPath    string
	KubectlPath string
	Timeout     time.Duration
}

// New returns the ModelSphere CLI root command.
func New() *cobra.Command {
	options := &Options{
		Kubeconfig:  os.Getenv("KUBECONFIG"),
		Context:     os.Getenv("KUBE_CONTEXT"),
		HelmPath:    "helm",
		KubectlPath: "kubectl",
		Timeout:     5 * time.Minute,
	}
	root := &cobra.Command{Use: "modelsphere", Short: "ModelSphere platform tools", SilenceUsage: true, SilenceErrors: true}
	root.PersistentFlags().StringVar(&options.ConfigPath, "config", "", "ModelSphere config file")
	root.PersistentFlags().StringVar(&options.Kubeconfig, "kubeconfig", options.Kubeconfig, "Kubernetes config file")
	root.PersistentFlags().StringVar(&options.Context, "context", options.Context, "Kubernetes context")
	root.PersistentFlags().StringVar(&options.HelmPath, "helm", options.HelmPath, "Helm executable")
	root.PersistentFlags().StringVar(&options.KubectlPath, "kubectl", options.KubectlPath, "kubectl executable")
	root.PersistentFlags().DurationVar(&options.Timeout, "timeout", options.Timeout, "External command timeout")
	root.AddCommand(pluginCommand(options))
	return root
}

func pluginCommand(options *Options) *cobra.Command {
	command := &cobra.Command{Use: "plugin", Short: "Validate, package, install and uninstall plugins"}
	command.AddCommand(validateCommand(), packageCommand(options), installCommand(options), uninstallCommand(options))
	return command
}

func validateCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "validate <chart-or-package>",
		Short: "Validate a ModelSphere plugin package",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			artifact, err := pluginpackage.Inspect(args[0])
			if err != nil {
				return err
			}
			_, err = fmt.Fprintf(cmd.OutOrStdout(), "Valid: %s %s (Chart %s %s)\n", artifact.Manifest.Name, artifact.Manifest.Version, artifact.Chart.Name, artifact.Chart.Version)
			return err
		},
	}
}

func packageCommand(options *Options) *cobra.Command {
	var destination string
	command := &cobra.Command{
		Use:   "package <chart-directory>",
		Short: "Validate and package a plugin Chart",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			artifact, err := pluginpackage.Inspect(args[0])
			if err != nil {
				return err
			}
			runner, err := options.runner()
			if err != nil {
				return err
			}
			if err := runner.Lint(cmd.Context(), args[0]); err != nil {
				return fmt.Errorf("lint plugin Chart: %w", err)
			}
			if err := os.MkdirAll(destination, 0755); err != nil {
				return fmt.Errorf("create package destination: %w", err)
			}
			output := filepath.Join(destination, artifact.Chart.Name+"-"+artifact.Chart.Version+".tgz")
			if _, err := os.Stat(output); err == nil {
				return fmt.Errorf("refusing to overwrite existing package %s", output)
			} else if !os.IsNotExist(err) {
				return fmt.Errorf("check package output %s: %w", output, err)
			}
			if err := runner.Package(cmd.Context(), args[0], destination); err != nil {
				return fmt.Errorf("package plugin Chart: %w", err)
			}
			if _, err := pluginpackage.Inspect(output); err != nil {
				return fmt.Errorf("validate generated package: %w", err)
			}
			_, err = fmt.Fprintln(cmd.OutOrStdout(), output)
			return err
		},
	}
	command.Flags().StringVarP(&destination, "destination", "d", ".", "Output directory")
	return command
}

type lifecycleFlags struct {
	consoleRelease   string
	consoleNamespace string
	consoleChart     string
	consoleVersion   string
	consoleURL       string
	pluginRelease    string
	pluginNamespace  string
	values           []string
	wait             bool
}

func (flags *lifecycleFlags) bind(command *cobra.Command, install bool) {
	command.Flags().StringVar(&flags.consoleRelease, "console-release", "", "Existing Console Helm release")
	command.Flags().StringVar(&flags.consoleNamespace, "console-namespace", "", "Console release namespace")
	command.Flags().StringVar(&flags.consoleChart, "console-chart", "", "Console Helm chart reference or path")
	command.Flags().StringVar(&flags.consoleVersion, "console-chart-version", "", "Console Helm chart version")
	command.Flags().StringVar(&flags.consoleURL, "console-url", "", "Optional Console URL for plugin index verification")
	command.Flags().StringVar(&flags.pluginRelease, "plugin-release", "", "Plugin Helm release; defaults to plugin name")
	command.Flags().StringVar(&flags.pluginNamespace, "plugin-namespace", "", "Plugin release namespace; defaults to Console namespace")
	command.Flags().BoolVar(&flags.wait, "wait", true, "Wait for Helm and Console readiness")
	if install {
		command.Flags().StringArrayVarP(&flags.values, "values", "f", nil, "Values file passed to the plugin Chart")
	}
}

func installCommand(options *Options) *cobra.Command {
	flags := &lifecycleFlags{}
	command := &cobra.Command{
		Use:   "install <chart-or-package>",
		Short: "Install or upgrade a plugin and register it with Console",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runInstall(cmd.Context(), cmd.OutOrStdout(), options, flags, args[0])
		},
	}
	flags.bind(command, true)
	return command
}

func uninstallCommand(options *Options) *cobra.Command {
	flags := &lifecycleFlags{}
	command := &cobra.Command{
		Use:   "uninstall <plugin>",
		Short: "Unregister and uninstall a plugin",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runUninstall(cmd.Context(), cmd.OutOrStdout(), options, flags, args[0])
		},
	}
	flags.bind(command, false)
	return command
}

func (options *Options) runner() (Runner, error) {
	settings, err := loadSettings(options.ConfigPath)
	if err != nil {
		return Runner{}, err
	}
	if options.Kubeconfig == "" {
		options.Kubeconfig = settings.Kubeconfig
	}
	if options.Context == "" {
		options.Context = settings.Context
	}
	if options.Timeout <= 0 {
		return Runner{}, fmt.Errorf("--timeout must be positive")
	}
	return Runner{HelmPath: options.HelmPath, KubectlPath: options.KubectlPath, Kubeconfig: options.Kubeconfig, Context: options.Context, CommandTimeout: options.Timeout}, nil
}

func resolveLifecycle(options *Options, flags *lifecycleFlags) (Settings, lifecycleFlags, error) {
	settings, err := loadSettings(options.ConfigPath)
	if err != nil {
		return Settings{}, lifecycleFlags{}, err
	}
	if flags.consoleRelease == "" {
		flags.consoleRelease = settings.Console.Release
	}
	if flags.consoleNamespace == "" {
		flags.consoleNamespace = settings.Console.Namespace
	}
	if flags.consoleChart == "" {
		flags.consoleChart = settings.Console.Chart
	}
	if flags.consoleVersion == "" {
		flags.consoleVersion = settings.Console.ChartVersion
	}
	if flags.consoleURL == "" {
		flags.consoleURL = settings.Console.URL
	}
	if flags.pluginNamespace == "" {
		flags.pluginNamespace = flags.consoleNamespace
	}
	if flags.consoleRelease == "" || flags.consoleNamespace == "" || flags.consoleChart == "" || flags.pluginNamespace == "" {
		return settings, lifecycleFlags{}, fmt.Errorf("Console release, namespace, chart and plugin namespace are required")
	}
	return settings, *flags, nil
}

type consoleValues struct {
	Backends []config.Backend `yaml:"backends,omitempty"`
	Plugins  []config.Plugin  `yaml:"plugins,omitempty"`
}

func loadConsoleValues(ctx context.Context, runner Runner, release, namespace string) (consoleValues, error) {
	data, err := runner.GetValues(ctx, release, namespace)
	if err != nil {
		return consoleValues{}, fmt.Errorf("read Console release values: %w", err)
	}
	var values consoleValues
	if err := yaml.Unmarshal(data, &values); err != nil {
		return consoleValues{}, fmt.Errorf("parse Console release values: %w", err)
	}
	return values, nil
}

func validateConsoleValues(values consoleValues) error {
	cfg := &config.Config{Server: config.Server{Auth: config.Auth{Disabled: true}}, Backends: values.Backends, Plugins: values.Plugins}
	if err := cfg.Validate(); err != nil {
		return fmt.Errorf("merged Console plugin configuration is invalid: %w", err)
	}
	return nil
}

func writePluginPatch(values []config.Plugin) (string, error) {
	data, err := yaml.Marshal(struct {
		Plugins []config.Plugin `yaml:"plugins"`
	}{Plugins: values})
	if err != nil {
		return "", fmt.Errorf("encode Console plugin values: %w", err)
	}
	file, err := os.CreateTemp("", "modelsphere-plugin-values-*.yaml")
	if err != nil {
		return "", fmt.Errorf("create temporary Console values: %w", err)
	}
	path := file.Name()
	if err := file.Chmod(0600); err != nil {
		file.Close()
		os.Remove(path)
		return "", fmt.Errorf("protect temporary Console values: %w", err)
	}
	if _, err := file.Write(data); err != nil {
		file.Close()
		os.Remove(path)
		return "", fmt.Errorf("write temporary Console values: %w", err)
	}
	if err := file.Close(); err != nil {
		os.Remove(path)
		return "", fmt.Errorf("close temporary Console values: %w", err)
	}
	return path, nil
}

func mergePlugin(plugins []config.Plugin, plugin config.Plugin) ([]config.Plugin, error) {
	merged := make([]config.Plugin, 0, len(plugins)+1)
	replaced := false
	for _, current := range plugins {
		if current.ID == plugin.ID {
			if replaced {
				return nil, fmt.Errorf("Console already contains duplicate plugin id %q", plugin.ID)
			}
			merged = append(merged, plugin)
			replaced = true
			continue
		}
		merged = append(merged, current)
	}
	if !replaced {
		merged = append(merged, plugin)
	}
	return merged, nil
}

func removePlugin(plugins []config.Plugin, id string) ([]config.Plugin, error) {
	filtered := make([]config.Plugin, 0, len(plugins))
	found := false
	for _, plugin := range plugins {
		if plugin.ID == id {
			if found {
				return nil, fmt.Errorf("Console already contains duplicate plugin id %q", id)
			}
			found = true
			continue
		}
		filtered = append(filtered, plugin)
	}
	if !found {
		return nil, fmt.Errorf("plugin %q is not registered in Console", id)
	}
	return filtered, nil
}

func runInstall(ctx context.Context, output io.Writer, options *Options, flags *lifecycleFlags, input string) error {
	artifact, resolved, runner, merged, err := prepareInstall(ctx, options, flags, input)
	if err != nil {
		return err
	}
	if err := runner.UpgradePlugin(ctx, resolved.pluginRelease, input, resolved.pluginNamespace, resolved.values, resolved.wait, options.Timeout); err != nil {
		return fmt.Errorf("install plugin Helm release: %w", err)
	}
	if err := checkServices(ctx, runner, artifact.Manifest, resolved.pluginRelease, resolved.pluginNamespace); err != nil {
		return err
	}
	patch, err := writePluginPatch(merged)
	if err != nil {
		return err
	}
	defer os.Remove(patch)
	if err := runner.UpgradeConsole(ctx, resolved.consoleRelease, resolved.consoleChart, resolved.consoleNamespace, resolved.consoleVersion, patch, resolved.wait, options.Timeout); err != nil {
		return fmt.Errorf("register plugin in Console: %w; plugin release remains installed", err)
	}
	if resolved.consoleURL != "" {
		found, err := runner.PluginIndex(ctx, resolved.consoleURL, artifact.Manifest.Name)
		if err != nil {
			return fmt.Errorf("verify Console plugin discovery: %w", err)
		}
		if !found {
			return fmt.Errorf("Console plugin index does not contain %q", artifact.Manifest.Name)
		}
	}
	_, err = fmt.Fprintf(output, "Installed: %s %s\n", artifact.Manifest.Name, artifact.Manifest.Version)
	return err
}

func prepareInstall(ctx context.Context, options *Options, flags *lifecycleFlags, input string) (pluginpackage.Artifact, lifecycleFlags, Runner, []config.Plugin, error) {
	artifact, err := pluginpackage.Inspect(input)
	if err != nil {
		return pluginpackage.Artifact{}, lifecycleFlags{}, Runner{}, nil, err
	}
	_, resolved, err := resolveLifecycle(options, flags)
	if err != nil {
		return pluginpackage.Artifact{}, lifecycleFlags{}, Runner{}, nil, err
	}
	if resolved.pluginRelease == "" {
		resolved.pluginRelease = artifact.Manifest.Name
	}
	runner, err := options.runner()
	if err != nil {
		return pluginpackage.Artifact{}, lifecycleFlags{}, Runner{}, nil, err
	}
	values, err := loadConsoleValues(ctx, runner, resolved.consoleRelease, resolved.consoleNamespace)
	if err != nil {
		return pluginpackage.Artifact{}, lifecycleFlags{}, Runner{}, nil, err
	}
	plugin, err := artifact.Manifest.ConsolePlugin(resolved.pluginRelease, resolved.pluginNamespace)
	if err != nil {
		return pluginpackage.Artifact{}, lifecycleFlags{}, Runner{}, nil, fmt.Errorf("build Console plugin configuration: %w", err)
	}
	merged, err := mergePlugin(values.Plugins, plugin)
	if err != nil {
		return pluginpackage.Artifact{}, lifecycleFlags{}, Runner{}, nil, err
	}
	if err := validateConsoleValues(consoleValues{Backends: values.Backends, Plugins: merged}); err != nil {
		return pluginpackage.Artifact{}, lifecycleFlags{}, Runner{}, nil, err
	}
	return artifact, resolved, runner, merged, nil
}

func runUninstall(ctx context.Context, output io.Writer, options *Options, flags *lifecycleFlags, id string) error {
	if !identifierPattern.MatchString(id) {
		return fmt.Errorf("plugin id %q must be lowercase kebab-case", id)
	}
	_, resolved, err := resolveLifecycle(options, flags)
	if err != nil {
		return err
	}
	if resolved.pluginRelease == "" {
		resolved.pluginRelease = id
	}
	runner, err := options.runner()
	if err != nil {
		return err
	}
	values, err := loadConsoleValues(ctx, runner, resolved.consoleRelease, resolved.consoleNamespace)
	if err != nil {
		return err
	}
	filtered, err := removePlugin(values.Plugins, id)
	if err != nil {
		return err
	}
	if err := validateConsoleValues(consoleValues{Backends: values.Backends, Plugins: filtered}); err != nil {
		return err
	}
	patch, err := writePluginPatch(filtered)
	if err != nil {
		return err
	}
	defer os.Remove(patch)
	if err := runner.UpgradeConsole(ctx, resolved.consoleRelease, resolved.consoleChart, resolved.consoleNamespace, resolved.consoleVersion, patch, resolved.wait, options.Timeout); err != nil {
		return fmt.Errorf("unregister plugin from Console: %w; plugin release was not removed", err)
	}
	if resolved.consoleURL != "" {
		found, err := runner.PluginIndex(ctx, resolved.consoleURL, id)
		if err != nil {
			return fmt.Errorf("verify Console plugin removal: %w", err)
		}
		if found {
			return fmt.Errorf("Console still discovers plugin %q after unregister", id)
		}
	}
	if err := runner.Uninstall(ctx, resolved.pluginRelease, resolved.pluginNamespace, resolved.wait, options.Timeout); err != nil {
		return fmt.Errorf("uninstall plugin Helm release: %w; Console registration was removed", err)
	}
	_, err = fmt.Fprintf(output, "Uninstalled: %s\n", id)
	return err
}

func checkServices(ctx context.Context, runner Runner, manifest pluginpackage.Manifest, release, namespace string) error {
	frontend, err := manifest.Frontend.Service.Resolve(release, namespace)
	if err != nil {
		return fmt.Errorf("resolve frontend Service: %w", err)
	}
	if err := runner.ServiceExists(ctx, frontend, namespace); err != nil {
		return fmt.Errorf("plugin frontend Service %s/%s is unavailable: %w", namespace, frontend, err)
	}
	if manifest.Backend == nil {
		return nil
	}
	backend, err := manifest.Backend.Service.Resolve(release, namespace)
	if err != nil {
		return fmt.Errorf("resolve backend Service: %w", err)
	}
	if err := runner.ServiceExists(ctx, backend, namespace); err != nil {
		return fmt.Errorf("plugin backend Service %s/%s is unavailable: %w", namespace, backend, err)
	}
	return nil
}

var identifierPattern = regexp.MustCompile(`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`)
