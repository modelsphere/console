package config

import (
	_ "embed"
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

//go:embed default-plugins.yaml
var defaultPluginYAML []byte

func defaultPlugins() []Plugin {
	var plugins []Plugin
	if err := yaml.Unmarshal(defaultPluginYAML, &plugins); err != nil {
		panic(fmt.Sprintf("invalid embedded frontend defaults: %v", err))
	}
	return plugins
}

// FrontendPlugins resolves the explicit tree or the defaults for legacy remote-only configurations.
func (c *Config) FrontendPlugins() []Plugin {
	if c.Plugins != nil && len(c.Plugins) == 0 {
		return c.Plugins
	}
	for _, plugin := range c.Plugins {
		if plugin.Source != "" || plugin.Folder != "" {
			return c.Plugins
		}
	}
	return append(defaultPlugins(), c.Plugins...)
}

// RemotePlugins returns only executable remote leaves, in configured traversal order.
func (c *Config) RemotePlugins() []Plugin {
	var remotes []Plugin
	var visit func([]Plugin)
	visit = func(nodes []Plugin) {
		for _, node := range nodes {
			if node.Folder != "" {
				visit(node.Children)
			} else if node.Source != "builtin" {
				remotes = append(remotes, node)
			}
		}
	}
	visit(c.Plugins)
	return remotes
}

type navigationValidator struct {
	plugins  map[string]bool
	folders  map[string]bool
	paths    map[string]bool
	builtins map[string]bool
}

func validatePlugins(plugins []Plugin) error {
	validator := navigationValidator{map[string]bool{}, map[string]bool{}, map[string]bool{}, map[string]bool{}}
	for _, builtin := range defaultPlugins() {
		validator.builtins[builtin.ID] = true
	}
	return validator.visit(plugins, "plugins")
}

func (v *navigationValidator) visit(nodes []Plugin, location string) error {
	for index, node := range nodes {
		path := fmt.Sprintf("%s[%d]", location, index)
		if err := v.node(node, path); err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
	}
	return nil
}

func (v *navigationValidator) node(node Plugin, path string) error {
	if node.Folder != "" {
		return v.folder(node, path)
	}
	if node.Title != "" || node.Children != nil {
		return fmt.Errorf("title and children require a folder")
	}
	if v.plugins[node.ID] {
		return fmt.Errorf("duplicate plugin id %q", node.ID)
	}
	v.plugins[node.ID] = true
	switch node.Source {
	case "builtin":
		if !v.builtins[node.ID] {
			return fmt.Errorf("unknown built-in module %q", node.ID)
		}
		if node.URL != "" || node.Entry != "" || len(node.Styles) != 0 || node.Development || node.Menu != (PluginMenu{}) {
			return fmt.Errorf("built-in modules cannot declare remote resources or menu overrides")
		}
	case "", "remote":
		if err := validatePlugin(node); err != nil {
			return err
		}
		if v.paths[node.Menu.Path] {
			return fmt.Errorf("duplicate menu path %q", node.Menu.Path)
		}
		v.paths[node.Menu.Path] = true
	default:
		return fmt.Errorf("unknown source %q; use builtin or remote", node.Source)
	}
	return nil
}

func (v *navigationValidator) folder(node Plugin, path string) error {
	if !pluginName.MatchString(node.Folder) || strings.TrimSpace(node.Title) == "" || len(node.Children) == 0 {
		return fmt.Errorf("folder requires a lowercase kebab-case name, title and nonempty children")
	}
	if v.folders[node.Folder] {
		return fmt.Errorf("duplicate folder %q", node.Folder)
	}
	v.folders[node.Folder] = true
	if node.ID != "" || node.Source != "" || node.URL != "" || node.Entry != "" || len(node.Styles) > 0 || node.Development || node.Menu != (PluginMenu{}) {
		return fmt.Errorf("folder cannot declare a plugin source, resources or a page menu")
	}
	return v.visit(node.Children, path+".children")
}
