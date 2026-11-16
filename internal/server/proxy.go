package server

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"slices"
	"strings"

	"github.com/modelsphere/console/internal/config"
	"github.com/modelsphere/console/internal/gateway"
)

// backendResource is the RBAC resource a backend is authorized as; the backend's
// name is the resourceName. A role granting verbs ["get"] on resources
// ["backends"], resourceNames ["swiss"] gives read-only access to swiss.
const backendResource = "backends"

// backendTarget is where one request goes and what credential it carries. Static
// backends have one for their whole life; a gateway backend gets the one the
// resolver currently knows.
type backendTarget struct {
	url    url.URL
	header string
	key    string
	// routes, on a gateway: the request goes to url plus the one serving its
	// model (see modelIndex).
	routes []string
}

type targetKey struct{}

func withTarget(ctx context.Context, t *backendTarget) context.Context {
	return context.WithValue(ctx, targetKey{}, t)
}

func targetFrom(ctx context.Context) *backendTarget {
	t, _ := ctx.Value(targetKey{}).(*backendTarget)
	return t
}

// unresolved stands in for a request that reached the proxy without a target --
// a bug in the mux rather than a configuration. It has to be something that fails
// to connect: proxying it as-is would send the request back to console itself.
var unresolved = &backendTarget{url: url.URL{Scheme: "http", Host: "backend-without-target.invalid"}}

// mountBackends proxies each backend's prefix. Authentication and the
// password-reset guard already ran (the prefix is under /api/); this adds
// per-backend authorization, swaps the caller's identity into the X-Remote-*
// headers the backend trusts -- the same headers Rise Global's apiserver sets
// for a ReverseProxy, so a backend runs unchanged behind either -- and adds the
// backend's own credential, if it has one.
//
// Backend URLs were checked by config.Validate; one that still fails to parse
// is skipped and logged rather than taking the server down.
func (s *Server) mountBackends(mux *http.ServeMux) {
	targets := s.backendTargets()
	catalogMounted := false
	for _, b := range s.cfg.Backends {
		resolve, ok := targets[b.Name]
		if !ok {
			continue
		}
		proxy := s.backendProxy(b)
		prefix := strings.TrimSuffix(b.Prefix, "/")
		catalogMounted = catalogMounted || prefix == "/api/llm"
		catalogResolve := resolve
		if b.Gateway != nil {
			catalogResolve = gatewayResolver(gateway.NewResolver(b, s.kube, s.log).ResolveCatalog)
		}
		mux.HandleFunc(prefix+"/route-options", func(w http.ResponseWriter, r *http.Request) {
			s.handleRouteOptions(w, r, b, catalogResolve)
		})
		mux.HandleFunc(strings.TrimSuffix(b.Prefix, "/")+"/", func(w http.ResponseWriter, r *http.Request) {
			if !s.authorize(w, r, backendVerb(r.Method), backendResource, b.Name) {
				return
			}
			parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
			if b.Name == "canary" && prefix == "/api/canary" && r.Method == http.MethodPatch && len(parts) == 5 && parts[2] == "experiments" && parts[4] == "traffic" {
				permissions, err := s.authz.PermissionsFor(r.Context(), identityFrom(r.Context()))
				if err != nil {
					writeError(w, http.StatusInternalServerError, err.Error())
					return
				}
				if !slices.Contains(permissions, "*") && !slices.Contains(permissions, "canary.write") {
					writeError(w, http.StatusForbidden, "canary.write permission required")
					return
				}
			}
			target, err := resolve(r.Context())
			if err != nil {
				// A gateway backend that cannot be found is a 502 like any other
				// unreachable backend, but the reason is the useful part.
				writeError(w, http.StatusBadGateway, fmt.Sprintf("backend %s: %v", b.Name, err))
				return
			}
			if b.Gateway != nil {
				target = s.routeByModel(w, r, b, target)
				if target == nil {
					return
				}
			}
			proxy.ServeHTTP(w, r.WithContext(withTarget(r.Context(), target)))
		})
	}
	if !catalogMounted {
		mux.HandleFunc("/api/llm/route-options", func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet {
				w.Header().Set("Allow", "GET")
				writeError(w, http.StatusMethodNotAllowed, "GET required")
				return
			}
			writeError(w, http.StatusNotFound, "no gateway backend configured")
		})
	}
}

// backendTargets resolves each backend once for the process: a gateway resolver
// holds a cache, and the router and the backend's own prefix share it.
func (s *Server) backendTargets() map[string]targetResolver {
	s.targetsOnce.Do(func() {
		s.targets = map[string]targetResolver{}
		for _, b := range s.cfg.Backends {
			resolve, err := s.targetFunc(b)
			if err != nil {
				s.log.Error("backend skipped", "backend", b.Name, "err", err)
				continue
			}
			s.targets[b.Name] = resolve
		}
	})
	return s.targets
}

type targetResolver func(context.Context) (*backendTarget, error)

// targetFunc is how a backend finds its target: once and forever when the config
// holds a URL, from the cluster on every request when it holds a gateway.
func (s *Server) targetFunc(b config.Backend) (targetResolver, error) {
	if b.Gateway != nil {
		if s.kube == nil {
			return nil, fmt.Errorf("gateway %+v needs cluster access, and this console has none", *b.Gateway)
		}
		return gatewayResolver(gateway.NewResolver(b, s.kube, s.log).Resolve), nil
	}

	target, err := url.Parse(b.URL)
	if err != nil {
		return nil, fmt.Errorf("bad url %q: %w", b.URL, err)
	}
	key := b.APIKey()
	if b.APIKeyEnv != "" && key == "" {
		s.log.Warn("backend credential is empty: requests go without it", "backend", b.Name, "env", b.APIKeyEnv)
	}
	fixed := &backendTarget{url: *target, header: "Authorization"}
	if key != "" {
		fixed.key = "Bearer " + key
	}
	return func(context.Context) (*backendTarget, error) { return fixed, nil }, nil
}

func gatewayResolver(resolve func(context.Context) (*gateway.Entry, error)) targetResolver {
	return func(ctx context.Context) (*backendTarget, error) {
		entry, err := resolve(ctx)
		if err != nil {
			return nil, err
		}
		base, err := url.Parse(entry.Base)
		if err != nil {
			return nil, err
		}
		return &backendTarget{url: *base, header: entry.Header, key: entry.Key, routes: entry.Routes}, nil
	}
}

func (s *Server) backendProxy(b config.Backend) *httputil.ReverseProxy {
	prefix := strings.TrimSuffix(b.Prefix, "/")
	return &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			target := targetFrom(pr.In.Context())
			if target == nil {
				target = unresolved
			}
			pr.Out.URL.Path = strings.TrimPrefix(pr.In.URL.Path, prefix)
			pr.Out.URL.RawPath = ""
			pr.SetURL(&target.url)
			pr.SetXForwarded()

			for k := range pr.Out.Header {
				if strings.HasPrefix(http.CanonicalHeaderKey(k), "X-Remote-") {
					pr.Out.Header.Del(k)
				}
			}
			pr.Out.Header.Del("Cookie")
			if id := identityFrom(pr.In.Context()); id != nil {
				pr.Out.Header.Set("X-Remote-User", id.Name)
				for _, g := range id.Groups {
					pr.Out.Header.Add("X-Remote-Group", g)
				}
			}
			// Carry the session as a Bearer header even when the browser sent it
			// only as a cookie, so a backend that verifies the JWT itself can.
			if tok := bearerToken(pr.In); tok != "" {
				pr.Out.Header.Set("Authorization", "Bearer "+tok)
			}
			// A backend with a credential of its own replaces that token: the
			// session authorizes the caller to console, not to the gateway.
			if target.key != "" {
				pr.Out.Header.Set(target.header, target.key)
			}
		},
		// Stream as it arrives: backends answer with SSE / chunked progress.
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			s.log.Warn("backend unreachable", "backend", b.Name, "path", r.URL.Path, "err", err)
			writeError(w, http.StatusBadGateway, "backend "+b.Name+" unreachable")
		},
	}
}

// backendVerb maps an HTTP method onto the RBAC verb checked for it.
func backendVerb(method string) string {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return "get"
	case http.MethodPost:
		return "create"
	case http.MethodPut, http.MethodPatch:
		return "update"
	case http.MethodDelete:
		return "delete"
	}
	return strings.ToLower(method)
}
