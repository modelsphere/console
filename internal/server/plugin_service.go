package server

import (
	"context"
	"github.com/modelsphere/console/internal/config"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

var pluginResourceTransport = newPluginResourceTransport()

func newPluginResourceTransport() *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 30 * time.Second
	return transport
}

func (s *Server) pluginIndex() []pluginManifest {
	return pluginTree(s.cfg.FrontendPlugins())
}

func pluginTree(nodes []config.Plugin) []pluginManifest {
	result := make([]pluginManifest, 0, len(nodes))
	for _, node := range nodes {
		if node.Folder != "" {
			result = append(result, pluginManifest{Folder: node.Folder, Title: node.Title, Children: pluginTree(node.Children)})
			continue
		}
		manifest := pluginManifest{ID: node.ID, Source: node.Source}
		if node.Source != "builtin" {
			prefix := "/plugins/" + node.ID + "/"
			manifest.Source, manifest.Entry, manifest.Menu = "remote", prefix+node.Entry, &node.Menu
			manifest.Development = node.Development
			for _, style := range node.Styles {
				manifest.Styles = append(manifest.Styles, prefix+style)
			}
		}
		result = append(result, manifest)
	}
	return result
}

func pluginProxyHeaders(request *httputil.ProxyRequest, development bool) {
	request.Out.Header = make(http.Header)
	headers := []string{"Accept", "Accept-Encoding", "Range", "If-None-Match", "If-Modified-Since"}
	if development {
		headers = append(headers, "Origin", "Sec-WebSocket-Key", "Sec-WebSocket-Version", "Sec-WebSocket-Protocol", "Sec-WebSocket-Extensions")
		if strings.EqualFold(request.In.Header.Get("Upgrade"), "websocket") {
			request.Out.Header.Set("Connection", "Upgrade")
			request.Out.Header.Set("Upgrade", "websocket")
		}
	}
	for _, header := range headers {
		if value := request.In.Header.Get(header); value != "" {
			request.Out.Header.Set(header, value)
		}
	}
}

func (s *Server) servePluginService(writer http.ResponseWriter, request *http.Request, plugin config.Plugin, asset string) {
	socket := strings.EqualFold(request.Header.Get("Upgrade"), "websocket")
	if !config.ValidPluginAsset(asset) || (request.Method != http.MethodGet && request.Method != http.MethodHead) || (socket && !plugin.Development) {
		http.NotFound(writer, request)
		return
	}
	upstream, err := url.Parse(plugin.URL)
	if err != nil {
		s.log.Error("parse plugin service URL", "plugin", plugin.ID, "error", err)
		writeError(writer, http.StatusBadGateway, "invalid plugin service")
		return
	}
	ctx := request.Context()
	if !socket {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
	}
	proxy := s.pluginResourceProxy(plugin, upstream, asset)
	proxy.ServeHTTP(writer, request.WithContext(ctx))
}

func (s *Server) pluginResourceProxy(plugin config.Plugin, upstream *url.URL, asset string) *httputil.ReverseProxy {
	return &httputil.ReverseProxy{
		Transport: pluginResourceTransport,
		Rewrite: func(out *httputil.ProxyRequest) {
			out.Out.URL.Path, out.Out.URL.RawPath = "/"+asset, ""
			if plugin.Development {
				out.Out.URL.Path = "/plugins/" + plugin.ID + "/" + asset
			}
			out.SetURL(upstream)
			if plugin.Development {
				out.Out.Host = out.In.Host
			}
			pluginProxyHeaders(out, plugin.Development)
		},
		ModifyResponse: func(response *http.Response) error {
			response.Header.Del("Set-Cookie")
			response.Header.Set("Cache-Control", "no-store")
			return nil
		},
		ErrorHandler: func(response http.ResponseWriter, _ *http.Request, cause error) {
			s.log.Error("plugin service unavailable", "plugin", plugin.ID, "error", cause)
			writeError(response, http.StatusBadGateway, "plugin service unavailable")
		},
	}
}
