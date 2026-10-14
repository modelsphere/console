package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strings"

	"github.com/modelsphere/console/internal/config"
	"github.com/modelsphere/console/internal/gateway"
)

var routeOptionName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]*$`)

func (s *Server) handleRouteOptions(w http.ResponseWriter, r *http.Request, b config.Backend, resolve targetResolver) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		writeError(w, http.StatusMethodNotAllowed, "GET required")
		return
	}
	if !s.authorize(w, r, "get", backendResource, b.Name) {
		return
	}
	route := r.URL.Query().Get("route")
	if route != "" && !routeOptionName.MatchString(route) {
		writeError(w, http.StatusBadRequest, "invalid route name")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), probeTimeout)
	defer cancel()
	target, err := resolve(ctx)
	if err != nil {
		if errors.Is(err, gateway.ErrNoRoutes) {
			writeError(w, http.StatusNotFound, "no route catalog available")
			return
		}
		writeError(w, http.StatusBadGateway, fmt.Sprintf("backend %s: %v", b.Name, err))
		return
	}
	routes := target.routes
	if b.Gateway == nil {
		if route != "" && route != strings.TrimPrefix(target.url.Path, "/") {
			writeError(w, http.StatusNotFound, "route not served by backend")
			return
		}
		routes = []string{""}
	} else if route != "" {
		if !slices.Contains(routes, route) {
			writeError(w, http.StatusNotFound, "route not served by backend")
			return
		}
		routes = []string{route}
	}
	client := &http.Client{Timeout: probeTimeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	failed := false
	for _, name := range routes {
		body, status, err := readRouteOptions(ctx, client, routeURL(target, name)+"/_route_opts")
		if status == http.StatusNotFound {
			continue
		}
		if err != nil || status != http.StatusOK {
			failed = true
			continue
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(body)
		return
	}
	if failed {
		writeError(w, http.StatusBadGateway, "gateway route catalog unavailable or invalid")
		return
	}
	writeError(w, http.StatusNotFound, "no route catalog available")
}

func readRouteOptions(ctx context.Context, client *http.Client, endpoint string) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, resp.StatusCode, nil
	}
	const max = 1 << 20
	body, err := io.ReadAll(io.LimitReader(resp.Body, max+1))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	var catalog struct {
		Route      string            `json:"route"`
		Directives []json.RawMessage `json:"directives"`
		Advanced   []json.RawMessage `json:"advanced"`
	}
	if len(body) > max || json.Unmarshal(body, &catalog) != nil || catalog.Route == "" || catalog.Directives == nil || catalog.Advanced == nil {
		return nil, resp.StatusCode, fmt.Errorf("invalid route catalog")
	}
	return body, resp.StatusCode, nil
}
