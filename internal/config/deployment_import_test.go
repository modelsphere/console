package config

import (
	"io"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func importConfig() *Config {
	return &Config{Server: Server{Auth: Auth{Disabled: true}}, Backends: []Backend{{Name: "swiss", Prefix: "/api/deploy", URL: "http://swiss.models.svc/api"}}, DeploymentImports: DeploymentImports{Enabled: true, Namespaces: []string{"models"}}}
}

func TestDeploymentImportsConfigDefaultsAndValidation(t *testing.T) {
	c := &Config{Server: Server{Auth: Auth{Disabled: true}}}
	c.applyDefaults()
	if c.DeploymentImports.Enabled || c.DeploymentImports.Backend != "swiss" || c.DeploymentImports.PlanConfigMapPrefix != "swiss-plan-" || len(c.DeploymentImports.Namespaces) != 0 {
		t.Fatalf("defaults=%+v", c.DeploymentImports)
	}
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name   string
		change func(*Config)
	}{
		{"empty namespaces", func(c *Config) { c.DeploymentImports.Namespaces = nil }},
		{"wildcard namespace", func(c *Config) { c.DeploymentImports.Namespaces = []string{"*"} }},
		{"namespace slash", func(c *Config) { c.DeploymentImports.Namespaces = []string{"models/other"} }},
		{"duplicate namespace", func(c *Config) { c.DeploymentImports.Namespaces = []string{"models", "models"} }},
		{"unknown backend", func(c *Config) { c.DeploymentImports.Backend = "missing" }},
		{"inference gateway", func(c *Config) {
			c.Backends[0].URL = ""
			c.Backends[0].Gateway = &Gateway{Profile: "models/site-profile"}
		}},
		{"wrong backend module", func(c *Config) { c.Backends[0].Prefix = "/api/other" }},
		{"invalid prefix", func(c *Config) { c.DeploymentImports.PlanConfigMapPrefix = "../" }},
		{"reserved route", func(c *Config) { c.Backends[0].Prefix = "/api/deployment-imports" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := importConfig()
			tt.change(c)
			if err := c.Validate(); err == nil {
				t.Fatal("invalid import configuration accepted")
			}
		})
	}
	if err := importConfig().Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestHelmDeploymentImportsConfigAndMinimalRoles(t *testing.T) {
	args := []string{"--set", "deploymentImports.enabled=true", "--set", "deploymentImports.namespaces={models,other}", "--set", "externalSwiss.url=http://swiss.swiss.svc/api"}
	c := renderChartConfig(t, args...)
	c.Server.Auth.JWTSecret = "test"
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
	if !c.DeploymentImports.Enabled || len(c.DeploymentImports.Namespaces) != 2 || c.DeploymentImports.PlanConfigMapPrefix != "swiss-plan-" {
		t.Fatalf("imports=%+v", c.DeploymentImports)
	}
	out, err := helmTemplate(t, args...)
	if err != nil {
		t.Fatalf("render: %v %s", err, out)
	}
	dec := yaml.NewDecoder(strings.NewReader(out))
	roles, bindings := 0, 0
	for {
		var doc struct {
			Kind     string                           `yaml:"kind"`
			Metadata struct{ Name, Namespace string } `yaml:"metadata"`
			Rules    []struct {
				APIGroups []string `yaml:"apiGroups"`
				Resources []string `yaml:"resources"`
				Verbs     []string `yaml:"verbs"`
			} `yaml:"rules"`
		}
		err := dec.Decode(&doc)
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasSuffix(doc.Metadata.Name, "-deployment-imports") {
			continue
		}
		if doc.Metadata.Namespace != "models" && doc.Metadata.Namespace != "other" {
			t.Fatalf("unexpected namespace: %s", doc.Metadata.Namespace)
		}
		switch doc.Kind {
		case "Role":
			roles++
			if len(doc.Rules) != 3 {
				t.Fatalf("rules=%v", doc.Rules)
			}
			for _, r := range doc.Rules {
				resources := strings.Join(r.Resources, ",")
				verbs := strings.Join(r.Verbs, ",")
				switch resources {
				case "secrets":
					if verbs != "get,list" {
						t.Fatalf("secret verbs=%s", verbs)
					}
				case "configmaps":
					if verbs != "get,create" {
						t.Fatalf("ConfigMap verbs=%s", verbs)
					}
				case "llmservices":
					if verbs != "get" || strings.Join(r.APIGroups, ",") != "serving.modelsphere.dev" {
						t.Fatalf("LLMService rule=%v", r)
					}
				default:
					t.Fatalf("unexpected resource=%s", resources)
				}
			}
		case "RoleBinding":
			bindings++
		default:
			t.Fatalf("unexpected kind=%s", doc.Kind)
		}
	}
	if roles != 2 || bindings != 2 {
		t.Fatalf("roles=%d bindings=%d", roles, bindings)
	}
	for _, extra := range [][]string{{"--set", "deploymentImports.enabled=false"}, {"--set", "rbac.create=false"}} {
		out, err := helmTemplate(t, append(append([]string{}, args...), extra...)...)
		if err != nil {
			t.Fatalf("render: %v %s", err, out)
		}
		if strings.Contains(out, "name: console-console-deployment-imports") {
			t.Fatal("import roles created when disabled or custom RBAC requested")
		}
	}
	out, err = helmTemplate(t, "--set", "deploymentImports.enabled=true")
	if err == nil || !strings.Contains(out, "deploymentImports.namespaces") {
		t.Fatalf("missing namespace guard: %v %s", err, out)
	}
}
