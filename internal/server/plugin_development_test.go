package server

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/modelsphere/console/internal/config"
)

func TestDevelopmentPluginDiscovery(t *testing.T) {
	srv := pluginServer(t)
	srv.cfg.Plugins = []config.Plugin{{ID: "example", URL: "http://frontend:4181", Entry: "__modelsphere_entry.ts", Development: true}}
	response := do(srv.Handler(), "GET", "/plugins/index.json", "", "")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"development": true`) {
		t.Fatalf("development discovery: %d %s", response.Code, response.Body.String())
	}
}

func TestDeploymentPluginRejectsWebSocket(t *testing.T) {
	upstreamCalled := false
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { upstreamCalled = true }))
	defer upstream.Close()
	srv := pluginServer(t)
	srv.cfg.Plugins = []config.Plugin{{ID: "example", URL: upstream.URL, Entry: "entry.js"}}
	request := httptest.NewRequest(http.MethodGet, "/plugins/example/__hmr", nil)
	request.Header.Set("Connection", "Upgrade")
	request.Header.Set("Upgrade", "websocket")
	response := httptest.NewRecorder()
	srv.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusNotFound || upstreamCalled {
		t.Fatalf("production upgrade: status=%d upstream=%v", response.Code, upstreamCalled)
	}
}

func TestDevelopmentPluginPreservesBaseAndConsoleHost(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Host != "console.example.test" || request.URL.Path != "/plugins/example/src/page.tsx" || request.URL.RawQuery != "t=123" {
			t.Errorf("development request: host=%s url=%s", request.Host, request.URL)
		}
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	srv := pluginServer(t)
	srv.cfg.Plugins = []config.Plugin{{ID: "example", URL: upstream.URL, Entry: "entry.js", Development: true}}
	request := httptest.NewRequest(http.MethodGet, "http://console.example.test/plugins/example/src/page.tsx?t=123", nil)
	response := httptest.NewRecorder()
	srv.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("development response: %d %s", response.Code, response.Body.String())
	}
}

func TestDevelopmentPluginProxiesWebSocket(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(echoDevelopmentSocket))
	defer upstream.Close()
	srv := pluginServer(t)
	srv.cfg.Plugins = []config.Plugin{{ID: "example", URL: upstream.URL, Entry: "entry.js", Development: true}}
	frontend := httptest.NewServer(srv.Handler())
	defer frontend.Close()
	connection, reader := openDevelopmentSocket(t, frontend.URL)
	if _, err := connection.Write([]byte("hmr-update")); err != nil {
		t.Fatal(err)
	}
	payload := make([]byte, len("hmr-update"))
	if _, err := io.ReadFull(reader, payload); err != nil {
		t.Fatal(err)
	}
	if string(payload) != "hmr-update" {
		t.Fatalf("payload: %q", payload)
	}
}

func echoDevelopmentSocket(writer http.ResponseWriter, request *http.Request) {
	if request.URL.Path != "/plugins/example/__hmr" || request.Header.Get("Sec-WebSocket-Protocol") != "vite-hmr" || request.Header.Get("Cookie") != "" || request.Header.Get("Authorization") != "" {
		http.Error(writer, "invalid development proxy headers", http.StatusBadRequest)
		return
	}
	connection, buffered, err := http.NewResponseController(writer).Hijack()
	if err != nil {
		http.Error(writer, err.Error(), http.StatusInternalServerError)
		return
	}
	defer connection.Close()
	if _, err := buffered.WriteString("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"); err != nil {
		return
	}
	if err := buffered.Flush(); err != nil {
		return
	}
	_, _ = io.Copy(connection, buffered)
}

func openDevelopmentSocket(t *testing.T, frontendURL string) (net.Conn, *bufio.Reader) {
	t.Helper()
	connection, err := net.DialTimeout("tcp", strings.TrimPrefix(frontendURL, "http://"), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	if err := connection.SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	_, err = fmt.Fprintf(connection, "GET /plugins/example/__hmr HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Protocol: vite-hmr\r\nCookie: token=must-not-leak\r\nAuthorization: Bearer must-not-leak\r\n\r\n")
	if err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(connection)
	response, err := http.ReadResponse(reader, nil)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("upgrade: %s", response.Status)
	}
	return connection, reader
}
