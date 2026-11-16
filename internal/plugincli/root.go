package plugincli

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"text/tabwriter"
	"time"

	pluginapi "github.com/modelsphere/console/api/plugin/v1alpha1"
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
	LogWriter   io.Writer
	Verbosity   int
	Timeout     time.Duration
}

// New returns the ModelSphere CLI root command.
func New() *cobra.Command {
	options := &Options{
		Kubeconfig:  os.Getenv("KUBECONFIG"),
		Context:     os.Getenv("KUBE_CONTEXT"),
		HelmPath:    "helm",
		KubectlPath: "kubectl",
		LogWriter:   os.Stderr,
		Timeout:     5 * time.Minute,
	}
	root := &cobra.Command{Use: "modelsphere", Short: "ModelSphere platform tools", SilenceUsage: true, SilenceErrors: true}
	root.PersistentFlags().StringVar(&options.ConfigPath, "config", "", "ModelSphere config file")
	root.PersistentFlags().StringVar(&options.Kubeconfig, "kubeconfig", options.Kubeconfig, "Kubernetes config file")
	root.PersistentFlags().StringVar(&options.Context, "context", options.Context, "Kubernetes context")
	root.PersistentFlags().StringVar(&options.HelmPath, "helm", options.HelmPath, "Helm executable")
	root.PersistentFlags().StringVar(&options.KubectlPath, "kubectl", options.KubectlPath, "kubectl executable")
	root.PersistentFlags().IntVarP(&options.Verbosity, "verbosity", "v", 0, "log verbosity (0-10)")
	root.PersistentFlags().DurationVar(&options.Timeout, "timeout", options.Timeout, "External command timeout")
	root.AddCommand(pluginCommand(options))
	return root
}

func pluginCommand(options *Options) *cobra.Command {
	command := &cobra.Command{Use: "plugin", Short: "Validate, package, install and uninstall plugins"}
	command.AddCommand(validateCommand(), packageCommand(options), listCommand(options), installCommand(options), uninstallCommand(options), registrationCommand(options))
	return command
}

func listCommand(options *Options) *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List plugins registered with Console",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runList(cmd.Context(), cmd.OutOrStdout(), options)
		},
	}
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
	var force bool
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
			packageDestination := destination
			if _, err := os.Stat(output); err == nil {
				if !force {
					return fmt.Errorf("package already exists at %s; use --force to replace it or --destination with a new directory", output)
				}
				packageDestination, err = os.MkdirTemp(destination, ".modelsphere-package-")
				if err != nil {
					return fmt.Errorf("create temporary package destination: %w", err)
				}
				defer os.RemoveAll(packageDestination)
			} else if !os.IsNotExist(err) {
				return fmt.Errorf("check package output %s: %w", output, err)
			}
			if err := runner.Package(cmd.Context(), args[0], packageDestination); err != nil {
				return fmt.Errorf("package plugin Chart: %w", err)
			}
			generated := filepath.Join(packageDestination, artifact.Chart.Name+"-"+artifact.Chart.Version+".tgz")
			if _, err := pluginpackage.Inspect(generated); err != nil {
				return fmt.Errorf("validate generated package: %w", err)
			}
			if packageDestination != destination {
				if err := os.Rename(generated, output); err != nil {
					return fmt.Errorf("move generated package to %s: %w", output, err)
				}
			}
			if _, err := pluginpackage.Inspect(output); err != nil {
				return fmt.Errorf("validate generated package: %w", err)
			}
			_, err = fmt.Fprintln(cmd.OutOrStdout(), output)
			return err
		},
	}
	command.Flags().StringVarP(&destination, "destination", "d", ".", "Output directory")
	command.Flags().BoolVar(&force, "force", false, "Replace an existing package after a successful rebuild")
	return command
}

type lifecycleFlags struct {
	consoleRelease     string
	consoleNamespace   string
	pluginRelease      string
	pluginNamespace    string
	platformValuesFile string
	values             []string
	wait               bool
	yes                bool
}

func (flags *lifecycleFlags) bind(command *cobra.Command, install bool) {
	command.Flags().StringVar(&flags.consoleRelease, "console-release", "", "Existing Console Helm release")
	command.Flags().StringVar(&flags.consoleNamespace, "console-namespace", "", "Console release namespace")
	command.Flags().StringVar(&flags.pluginNamespace, "plugin-namespace", "", "Plugin release namespace; defaults to Console namespace")
	command.Flags().BoolVar(&flags.wait, "wait", true, "Wait for the plugin Helm release")
	if !install {
		command.Flags().BoolVar(&flags.yes, "yes", false, "Skip uninstall confirmation")
	}
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
		Use:   "uninstall [plugin]",
		Short: "Unregister and uninstall a plugin",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			plugin := ""
			if len(args) == 1 {
				plugin = args[0]
			}
			return runUninstall(cmd.Context(), cmd.InOrStdin(), cmd.OutOrStdout(), options, flags, plugin)
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
	if options.Verbosity < 0 || options.Verbosity > 10 {
		return Runner{}, fmt.Errorf("--verbosity must be between 0 and 10")
	}
	return Runner{
		HelmPath:       options.HelmPath,
		KubectlPath:    options.KubectlPath,
		Kubeconfig:     options.Kubeconfig,
		Context:        options.Context,
		LogWriter:      options.LogWriter,
		Verbosity:      options.Verbosity,
		CommandTimeout: options.Timeout,
	}, nil
}

func resolveLifecycle(ctx context.Context, options *Options, flags *lifecycleFlags) (Settings, lifecycleFlags, Runner, error) {
	settings, err := loadSettings(options.ConfigPath)
	if err != nil {
		return Settings{}, lifecycleFlags{}, Runner{}, err
	}
	runner, err := options.runner()
	if err != nil {
		return Settings{}, lifecycleFlags{}, Runner{}, err
	}
	if flags.consoleRelease == "" {
		flags.consoleRelease = settings.Console.Release
	}
	if flags.consoleNamespace == "" {
		flags.consoleNamespace = settings.Console.Namespace
	}
	if flags.consoleRelease == "" || flags.consoleNamespace == "" {
		release, err := discoverConsole(ctx, runner, flags.consoleRelease, flags.consoleNamespace)
		if err != nil {
			return Settings{}, lifecycleFlags{}, Runner{}, err
		}
		if flags.consoleRelease == "" {
			flags.consoleRelease = release.Name
		}
		if flags.consoleNamespace == "" {
			flags.consoleNamespace = release.Namespace
		}
	}
	if flags.pluginNamespace == "" {
		flags.pluginNamespace = flags.consoleNamespace
	}
	if flags.consoleRelease == "" || flags.consoleNamespace == "" || flags.pluginNamespace == "" {
		return Settings{}, lifecycleFlags{}, Runner{}, fmt.Errorf("Console release, namespace and plugin namespace are required")
	}
	return settings, *flags, runner, nil
}

func discoverConsole(ctx context.Context, runner Runner, releaseName, namespace string) (HelmRelease, error) {
	releases, err := runner.ListDeployedReleases(ctx)
	if err != nil {
		return HelmRelease{}, err
	}
	candidates := make([]HelmRelease, 0, len(releases))
	for _, release := range releases {
		if !isConsoleRelease(release) || !strings.EqualFold(release.Status, "deployed") {
			continue
		}
		if releaseName != "" && release.Name != releaseName {
			continue
		}
		if namespace != "" && release.Namespace != namespace {
			continue
		}
		candidates = append(candidates, release)
	}
	if len(candidates) == 1 {
		return candidates[0], nil
	}
	if len(candidates) == 0 {
		return HelmRelease{}, fmt.Errorf("cannot discover a deployed Console Helm release; use --console-release and --console-namespace")
	}
	identities := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		identities = append(identities, candidate.Name+" / "+candidate.Namespace)
	}
	return HelmRelease{}, fmt.Errorf("found multiple Console Helm releases (%s); use --console-release and --console-namespace", strings.Join(identities, ", "))
}

func isConsoleRelease(release HelmRelease) bool {
	return strings.HasPrefix(release.Chart, "console-") || release.Name == "console" || strings.HasPrefix(release.Name, "modelsphere-console")
}

type consoleValues struct {
	ImagePullSecrets []imagePullSecret   `yaml:"imagePullSecrets,omitempty"`
	ExternalSwiss    externalSwissValues `yaml:"externalSwiss,omitempty"`
	Platform         platformValues      `yaml:"platform,omitempty"`
}

type externalSwissValues struct {
	URL      string                `yaml:"url,omitempty"`
	ProxyKey externalSwissProxyKey `yaml:"proxyKey,omitempty"`
}

type externalSwissProxyKey struct {
	SecretName string `yaml:"secretName,omitempty"`
	Key        string `yaml:"key,omitempty"`
}

type platformValues struct {
	InferenceNamespaces []string `yaml:"inferenceNamespaces,omitempty"`
}

type pluginPlatformValues struct {
	ImagePullSecrets []imagePullSecret  `yaml:"imagePullSecrets,omitempty"`
	TargetNamespaces []string           `yaml:"targetNamespaces,omitempty"`
	Swiss            *pluginSwissValues `yaml:"swiss,omitempty"`
}

type imagePullSecret struct {
	Name string `yaml:"name"`
}

type pluginSwissValues struct {
	URL            string `yaml:"url,omitempty"`
	ProxySecret    string `yaml:"proxySecret,omitempty"`
	ProxySecretKey string `yaml:"proxySecretKey,omitempty"`
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

func writePlatformValues(values consoleValues, requirements pluginpackage.Requirements) (string, error) {
	if !requirements.Swiss && !requirements.InferenceNamespaces && !requirements.ImagePullSecrets {
		return "", nil
	}
	override := pluginPlatformValues{}
	if requirements.ImagePullSecrets {
		override.ImagePullSecrets = append([]imagePullSecret(nil), values.ImagePullSecrets...)
	}
	if requirements.InferenceNamespaces {
		override.TargetNamespaces = platformInferenceNamespaces(values)
		if len(override.TargetNamespaces) == 0 {
			return "", fmt.Errorf("plugin requires platform.inferenceNamespaces; configure it in the Console Helm values")
		}
	}
	if requirements.Swiss {
		swissURL, err := baseSwissURL(values.ExternalSwiss.URL)
		if err != nil {
			return "", fmt.Errorf("plugin requires externalSwiss.url: %w", err)
		}
		override.Swiss = &pluginSwissValues{
			URL:            swissURL,
			ProxySecret:    values.ExternalSwiss.ProxyKey.SecretName,
			ProxySecretKey: values.ExternalSwiss.ProxyKey.Key,
		}
		if override.Swiss.ProxySecretKey == "" {
			override.Swiss.ProxySecretKey = "proxyKey"
		}
	}
	data, err := yaml.Marshal(override)
	if err != nil {
		return "", fmt.Errorf("encode platform plugin values: %w", err)
	}
	file, err := os.CreateTemp("", "modelsphere-platform-values-*.yaml")
	if err != nil {
		return "", fmt.Errorf("create platform plugin values: %w", err)
	}
	path := file.Name()
	if err := file.Chmod(0600); err != nil {
		file.Close()
		os.Remove(path)
		return "", fmt.Errorf("protect platform plugin values: %w", err)
	}
	if _, err := file.Write(data); err != nil {
		file.Close()
		os.Remove(path)
		return "", fmt.Errorf("write platform plugin values: %w", err)
	}
	if err := file.Close(); err != nil {
		os.Remove(path)
		return "", fmt.Errorf("close platform plugin values: %w", err)
	}
	return path, nil
}

func platformInferenceNamespaces(values consoleValues) []string {
	return append([]string(nil), values.Platform.InferenceNamespaces...)
}

func baseSwissURL(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("must be an absolute URL without credentials, query or fragment")
	}
	path := strings.TrimSuffix(parsed.Path, "/")
	if path != "/api" {
		return "", fmt.Errorf("must end with /api (got %q)", parsed.Path)
	}
	parsed.Path = ""
	parsed.RawPath = ""
	return strings.TrimSuffix(parsed.String(), "/"), nil
}

func configuredPluginIdentity(plugin config.Plugin) string {
	return config.PluginIdentity(plugin.Group, plugin.ID)
}

func selectConfiguredPlugin(plugins []config.Plugin, selector string) (config.Plugin, error) {
	if selector == "" {
		return config.Plugin{}, fmt.Errorf("plugin identity is required")
	}
	for _, plugin := range plugins {
		if configuredPluginIdentity(plugin) == selector {
			return plugin, nil
		}
	}
	if identifierPattern.MatchString(selector) {
		var match *config.Plugin
		for index := range plugins {
			if plugins[index].ID != selector {
				continue
			}
			if match != nil {
				return config.Plugin{}, fmt.Errorf("plugin name %q is ambiguous; use group/name", selector)
			}
			match = &plugins[index]
		}
		if match != nil {
			return *match, nil
		}
	}
	return config.Plugin{}, fmt.Errorf("plugin %q is not registered in Console", selector)
}

func runList(ctx context.Context, output io.Writer, options *Options) error {
	runner, err := options.runner()
	if err != nil {
		return err
	}
	plugins, err := runner.Registrations(ctx)
	if err != nil {
		return err
	}
	writer := tabwriter.NewWriter(output, 0, 4, 2, ' ', 0)
	if _, err := fmt.Fprintln(writer, "IDENTITY\tVERSION\tKIND\tRELEASE\tSTATUS"); err != nil {
		return err
	}
	for _, plugin := range plugins {
		identity, ok := pluginapi.ParsePluginResourceName(plugin.Name)
		if !ok {
			continue
		}
		version := "-"
		if plugin.Status.PluginMeta != nil {
			version = plugin.Status.PluginMeta.Version
		}
		status := string(plugin.Status.Phase)
		if status == "" {
			status = "Pending"
		}
		if !plugin.Spec.Enabled {
			status = "Disabled"
		}
		release := plugin.Spec.Chart.ReleaseName
		if release == "" {
			release = plugin.Name
		}
		if _, err := fmt.Fprintf(writer, "%s\t%s\tPlugin\t%s\t%s\n", identity.String(), version, release, status); err != nil {
			return err
		}
	}
	return writer.Flush()
}

func choosePlugin(input *bufio.Reader, output io.Writer, plugins []config.Plugin) (config.Plugin, error) {
	if len(plugins) == 0 {
		return config.Plugin{}, fmt.Errorf("no plugins are registered in Console")
	}
	for index, plugin := range plugins {
		version := plugin.Version
		if version == "" {
			version = "-"
		}
		if _, err := fmt.Fprintf(output, "%d. %s %s release=%s\n", index+1, configuredPluginIdentity(plugin), version, pluginRelease(plugin)); err != nil {
			return config.Plugin{}, err
		}
	}
	if _, err := fmt.Fprint(output, "Select plugin [1-", len(plugins), "]: "); err != nil {
		return config.Plugin{}, err
	}
	line, err := input.ReadString('\n')
	if err != nil && len(strings.TrimSpace(line)) == 0 {
		return config.Plugin{}, fmt.Errorf("read plugin selection: %w", err)
	}
	choice, err := strconv.Atoi(strings.TrimSpace(line))
	if err != nil || choice < 1 || choice > len(plugins) {
		return config.Plugin{}, fmt.Errorf("plugin selection must be a number from 1 to %d", len(plugins))
	}
	return plugins[choice-1], nil
}

func pluginRelease(plugin config.Plugin) string {
	if plugin.Release != "" {
		return plugin.Release
	}
	return plugin.ID
}

func runInstall(ctx context.Context, output io.Writer, options *Options, flags *lifecycleFlags, input string) error {
	artifact, resolved, runner, err := prepareInstall(ctx, options, flags, input)
	if err != nil {
		return err
	}
	if resolved.platformValuesFile != "" {
		defer os.Remove(resolved.platformValuesFile)
	}
	if err := runner.UpgradePlugin(ctx, resolved.pluginRelease, input, resolved.pluginNamespace, resolved.values, resolved.wait, options.Timeout); err != nil {
		return fmt.Errorf("install plugin runtime: %w", err)
	}
	_, err = fmt.Fprintf(output, "Installed runtime: %s/%s %s\nRegistration is separate: create a Plugin CR to load it in Console.\n", artifact.Manifest.Group, artifact.Manifest.Name, artifact.Manifest.Version)
	return err
}

func prepareInstall(ctx context.Context, options *Options, flags *lifecycleFlags, input string) (pluginpackage.Artifact, lifecycleFlags, Runner, error) {
	artifact, err := pluginpackage.Inspect(input)
	if err != nil {
		return pluginpackage.Artifact{}, lifecycleFlags{}, Runner{}, err
	}
	_, resolved, runner, err := resolveLifecycle(ctx, options, flags)
	if err != nil {
		return artifact, resolved, runner, err
	}
	values, err := loadConsoleValues(ctx, runner, resolved.consoleRelease, resolved.consoleNamespace)
	if err != nil {
		return artifact, resolved, runner, err
	}
	requirements, err := platformRequirements(artifact.Manifest, resolved.consoleNamespace, resolved.pluginNamespace)
	if err != nil {
		return artifact, resolved, runner, err
	}
	resolved.pluginRelease = artifact.Manifest.Name
	platformFile, err := writePlatformValues(values, requirements)
	if err != nil {
		return artifact, resolved, runner, err
	}
	resolved.platformValuesFile = platformFile
	if platformFile != "" {
		resolved.values = append(resolved.values, platformFile)
	}
	return artifact, resolved, runner, nil
}

// platformRequirements takes the plugin's declared host dependencies and
// rejects the ones the host cannot supply for this installation.
func platformRequirements(manifest pluginpackage.Manifest, consoleNamespace, pluginNamespace string) (pluginpackage.Requirements, error) {
	requirements := manifest.Requires
	if requirements.ImagePullSecrets && pluginNamespace != consoleNamespace {
		return pluginpackage.Requirements{}, fmt.Errorf("plugin requires Console imagePullSecrets, which are namespace-scoped; install it in %q or remove the requirement", consoleNamespace)
	}
	return requirements, nil
}

func runUninstall(ctx context.Context, input io.Reader, output io.Writer, options *Options, flags *lifecycleFlags, selector string) error {
	runner, err := options.runner()
	if err != nil {
		return err
	}
	registrations, err := runner.Registrations(ctx)
	if err != nil {
		return err
	}
	plugins := registrationChoices(registrations)
	reader := bufio.NewReader(input)
	selected, err := selectUninstallPlugin(reader, output, plugins, selector)
	if err != nil {
		return err
	}
	if !flags.yes {
		if err := confirmUninstall(reader, output, configuredPluginIdentity(selected)); err != nil {
			return err
		}
	}
	for _, registration := range registrations {
		identity, valid := pluginapi.ParsePluginResourceName(registration.Name)
		if !valid || identity.String() != configuredPluginIdentity(selected) {
			continue
		}
		if err := runner.RemoveRegistration(ctx, registration.Name); err != nil {
			return fmt.Errorf("remove plugin registration: %w; runtime was not uninstalled", err)
		}
		release := registration.Spec.Chart.ReleaseName
		if release == "" {
			release = registration.Name
		}
		if err := runner.Uninstall(ctx, release, registration.Spec.Chart.Namespace, flags.wait, options.Timeout); err != nil {
			return fmt.Errorf("uninstall runtime after unregistering plugin: %w", err)
		}
		_, err = fmt.Fprintf(output, "Uninstalled: %s\n", identity.String())
		return err
	}
	return fmt.Errorf("plugin registration disappeared")
}

func selectUninstallPlugin(input *bufio.Reader, output io.Writer, plugins []config.Plugin, selector string) (config.Plugin, error) {
	if selector != "" {
		return selectConfiguredPlugin(plugins, selector)
	}
	return choosePlugin(input, output, plugins)
}

func confirmUninstall(input *bufio.Reader, output io.Writer, identity string) error {
	if _, err := fmt.Fprintf(output, "Continue uninstall %s? [y/N]: ", identity); err != nil {
		return err
	}
	line, err := input.ReadString('\n')
	if err != nil && len(strings.TrimSpace(line)) == 0 {
		return fmt.Errorf("read uninstall confirmation: %w", err)
	}
	answer := strings.ToLower(strings.TrimSpace(line))
	if answer != "y" && answer != "yes" {
		return fmt.Errorf("uninstall cancelled")
	}
	return nil
}

var identifierPattern = regexp.MustCompile(`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`)
