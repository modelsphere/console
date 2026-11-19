package plugincli

import (
	"context"
	"encoding/json"
	"fmt"

	pluginapi "github.com/modelsphere/console/api/plugin/v1alpha1"
	"github.com/modelsphere/console/internal/pluginpackage"
	"github.com/spf13/cobra"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/yaml"
)

func (r Runner) Registrations(ctx context.Context) ([]pluginapi.Plugin, error) {
	data, err := r.kubectl(ctx, "get", "plugins.modelsphere.dev", "--output", "json")
	if err != nil {
		return nil, fmt.Errorf("read plugin registrations: %w", err)
	}
	var list pluginapi.PluginList
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, fmt.Errorf("decode plugin registrations: %w", err)
	}
	return list.Items, nil
}

func (r Runner) RemoveRegistration(ctx context.Context, name string) error {
	_, err := r.kubectl(ctx, "delete", "plugins.modelsphere.dev", name, "--wait=true")
	return err
}

// pluginChoice is one Plugin CR the CLI can act on, reduced to what selection
// and uninstall need.
type pluginChoice struct {
	Group   string
	Name    string
	Release string
	Version string
}

// identity is the stable group/name selector users pass on the command line.
func (c pluginChoice) identity() string {
	return pluginapi.PluginIdentity{Group: c.Group, Name: c.Name}.String()
}

// releaseName is the Helm release behind the CR, defaulting to the plugin name.
func (c pluginChoice) releaseName() string {
	if c.Release != "" {
		return c.Release
	}
	return c.Name
}

func registrationChoices(plugins []pluginapi.Plugin) []pluginChoice {
	choices := []pluginChoice{}
	for _, plugin := range plugins {
		identity, ok := pluginapi.ParsePluginResourceName(plugin.Name)
		if !ok {
			continue
		}
		choice := pluginChoice{Group: identity.Group, Name: identity.Name, Release: plugin.Spec.Chart.ReleaseName}
		if plugin.Status.PluginMeta != nil {
			choice.Version = plugin.Status.PluginMeta.Version
		}
		choices = append(choices, choice)
	}
	return choices
}

// registrationCommand renders a declaration for an explicit, separate apply.
func registrationCommand(options *Options) *cobra.Command {
	flags := &lifecycleFlags{}
	command := &cobra.Command{Use: "registration <chart-or-package>", Short: "Print a Plugin CR for manual registration", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		artifact, err := pluginpackage.Inspect(args[0])
		if err != nil {
			return err
		}
		_, resolved, _, err := resolveLifecycle(cmd.Context(), options, flags)
		if err != nil {
			return err
		}
		identity := pluginapi.PluginIdentity{Group: artifact.Manifest.Group, Name: artifact.Manifest.Name}
		name, err := identity.ResourceName()
		if err != nil {
			return err
		}
		plugin := pluginapi.Plugin{TypeMeta: metav1.TypeMeta{APIVersion: pluginapi.GroupVersion.String(), Kind: "Plugin"}, ObjectMeta: metav1.ObjectMeta{Name: name}, Spec: pluginapi.PluginSpec{Type: pluginapi.PluginTypeHelm, Scope: "platform", Enabled: true, Version: artifact.Chart.Version, Chart: pluginapi.ChartConfig{Name: artifact.Chart.Name, Namespace: resolved.pluginNamespace, ReleaseName: artifact.Manifest.Name}}}
		data, err := yaml.Marshal(plugin)
		if err != nil {
			return err
		}
		_, err = cmd.OutOrStdout().Write(data)
		return err
	}}
	flags.bind(command, true)
	return command
}
