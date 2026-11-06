package config

import (
	"fmt"
	"io/fs"
	"net/url"
	"regexp"
	"strings"
)

// Plugin identifies a trusted frontend image service and its navigation entry.
type Plugin struct {
	Source      string     `yaml:"source,omitempty" json:"source,omitempty"`
	Folder      string     `yaml:"folder,omitempty" json:"folder,omitempty"`
	Title       string     `yaml:"title,omitempty" json:"title,omitempty"`
	Children    []Plugin   `yaml:"children,omitempty" json:"children,omitempty"`
	Development bool       `yaml:"development,omitempty" json:"development,omitempty"`
	ID          string     `yaml:"id" json:"id"`
	URL         string     `yaml:"url" json:"-"`
	Entry       string     `yaml:"entry" json:"entry"`
	Styles      []string   `yaml:"styles,omitempty" json:"styles,omitempty"`
	Menu        PluginMenu `yaml:"menu" json:"menu"`
}

type PluginMenu struct {
	Title     string `yaml:"title" json:"title"`
	Label     string `yaml:"label" json:"label"`
	Path      string `yaml:"path" json:"path"`
	Component string `yaml:"component" json:"component"`
	Icon      string `yaml:"icon,omitempty" json:"icon,omitempty"`
}

var pluginName = regexp.MustCompile(`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`)
var pluginBase = regexp.MustCompile(`^/[a-z][a-z0-9-]*$`)

// ValidPluginAsset limits assets to relative URL paths inside the image service.
func ValidPluginAsset(asset string) bool {
	return asset != "." && fs.ValidPath(asset) && !strings.ContainsAny(asset, `\?#%:`)
}

func validatePlugin(plugin Plugin) error {
	if !pluginName.MatchString(plugin.ID) {
		return fmt.Errorf("id %q must be lowercase kebab-case", plugin.ID)
	}
	upstream, err := url.Parse(plugin.URL)
	if err != nil || (upstream.Scheme != "http" && upstream.Scheme != "https") || upstream.Host == "" || upstream.User != nil || upstream.RawQuery != "" || upstream.Fragment != "" {
		return fmt.Errorf("url must be an absolute http(s) service URL without credentials, query or fragment")
	}
	for _, asset := range append([]string{plugin.Entry}, plugin.Styles...) {
		if !ValidPluginAsset(asset) {
			return fmt.Errorf("asset %q must be a relative file path", asset)
		}
	}
	menu := plugin.Menu
	if menu.Title == "" || menu.Label == "" || menu.Component == "" || !pluginBase.MatchString(menu.Path) {
		return fmt.Errorf("menu needs title, label, component and a path like /example")
	}
	for _, reserved := range []string{"/login", "/change-password", "/api", "/oauth", "/plugins", "/assets"} {
		if menu.Path == reserved {
			return fmt.Errorf("menu path %q is reserved", menu.Path)
		}
	}
	return nil
}
