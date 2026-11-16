package plugincli

import (
	"context"
	"encoding/json"
	"fmt"

	pluginapi "github.com/modelsphere/console/api/plugin/v1alpha1"
	"github.com/modelsphere/console/internal/config"
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

func registrationChoices(plugins []pluginapi.Plugin) []config.Plugin {
	choices := []config.Plugin{}
	for _, plugin := range plugins {
		identity, ok := pluginapi.ParsePluginResourceName(plugin.Name)
		if !ok {
			continue
		}
		choices = append(choices, config.Plugin{ID: identity.Name, Group: identity.Group, Release: plugin.Spec.Chart.ReleaseName})
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
