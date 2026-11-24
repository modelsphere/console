package pluginregistry

import (
	"fmt"
	"io"
	"net/url"
	"path"
	"strings"

	pluginapi "github.com/modelsphere/console/api/plugin/v1alpha1"
	"github.com/modelsphere/console/internal/config"
	"github.com/modelsphere/console/internal/iam"
	"k8s.io/apimachinery/pkg/util/yaml"
	sigyaml "sigs.k8s.io/yaml"
)

func readRoutes(manifest string, meta *pluginapi.PluginMeta) ([]Route, error) {
	decoder := yaml.NewYAMLOrJSONDecoder(strings.NewReader(manifest), 4096)
	routes := []Route{}
	for {
		var resource map[string]any
		if err := decoder.Decode(&resource); err == io.EOF {
			return routes, nil
		} else if err != nil {
			return nil, fmt.Errorf("parse installed release resources: %w", err)
		}
		if resource["kind"] != "ReverseProxy" || resource["apiVersion"] != iam.Group+"/"+iam.Version {
			continue
		}
		data, err := sigyaml.Marshal(resource)
		if err != nil {
			return nil, err
		}
		var route Route
		if err := sigyaml.UnmarshalStrict(data, &route); err != nil {
			return nil, fmt.Errorf("parse plugin ReverseProxy: %w", err)
		}
		if err := validateRoute(route, meta); err != nil {
			return nil, err
		}
		routes = append(routes, route)
	}
}

func validateRoute(route Route, meta *pluginapi.PluginMeta) error {
	prefix := strings.TrimSuffix(route.Spec.Matcher.Path, "/*")
	if !strings.HasSuffix(route.Spec.Matcher.Path, "/*") || path.Clean(prefix) != prefix || strings.ContainsAny(prefix, "%\\?#*") {
		return fmt.Errorf("plugin ReverseProxy requires a clean path prefix ending in /*")
	}
	if prefix == "/api" || config.ReservedAPIPrefix(prefix) {
		return fmt.Errorf("plugin ReverseProxy prefix %q is reserved by console", prefix)
	}
	directives := route.Spec.Directives
	if directives.SkipAuthentication {
		owned := "/oapis/" + meta.Group + "/" + meta.APIVersion + "/" + meta.Name
		if prefix != owned || route.Spec.Matcher.Method != "GET" || directives.AuthProxy {
			return fmt.Errorf("public plugin ReverseProxy must be GET %s/* without authProxy", owned)
		}
	} else if !directives.AuthProxy || (!strings.HasPrefix(prefix, "/api/") && !validOAPIPrefix(prefix)) {
		return fmt.Errorf("plugin ReverseProxy must authenticate an /api/ or versioned /oapis/ prefix")
	}
	if directives.StripPathPrefix != "" && directives.StripPathPrefix != prefix {
		return fmt.Errorf("plugin ReverseProxy stripPathPrefix must match its route prefix")
	}
	if directives.Method != "" || directives.StripPathSuffix != "" || directives.WrapTransport || len(directives.HeaderUp)+len(directives.HeaderDown)+len(directives.Rewrite)+len(directives.Replace) != 0 {
		return fmt.Errorf("plugin ReverseProxy contains unsupported directives")
	}
	upstream := route.Spec.Upstream
	parsed, err := url.Parse(upstream.Scheme + "://" + upstream.Host)
	if err != nil || (upstream.Scheme != "http" && upstream.Scheme != "https") || parsed.Hostname() != upstream.Host || parsed.User != nil || parsed.Path != "" || upstream.Port < 1 || upstream.Port > 65535 || upstream.InsecureSkipVerify || upstream.CABundle != "" {
		return fmt.Errorf("invalid or unsupported plugin ReverseProxy upstream")
	}
	return nil
}

func validOAPIPrefix(prefix string) bool {
	segments := strings.Split(strings.TrimPrefix(prefix, "/oapis/"), "/")
	return strings.HasPrefix(prefix, "/oapis/") && len(segments) >= 2 && segments[0] != "" && strings.HasPrefix(segments[1], "v")
}
