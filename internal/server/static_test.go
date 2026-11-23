package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestSpaCacheControl(t *testing.T) {
	web := fstest.MapFS{
		"index.html":          {Data: []byte("<html>shell</html>")},
		"assets/index-abc.js": {Data: []byte("console.log(1)")},
	}
	tests := []struct {
		name   string
		path   string
		status int
		cache  string
		body   string
	}{
		{"shell", "/", http.StatusOK, "no-cache", "<html>shell</html>"},
		{"hashed asset", "/assets/index-abc.js", http.StatusOK, "public, max-age=31536000, immutable", "console.log(1)"},
		{"client route", "/canary", http.StatusOK, "no-cache", "<html>shell</html>"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			s := &Server{web: web}
			rec := httptest.NewRecorder()
			s.spa(rec, httptest.NewRequest(http.MethodGet, test.path, nil))
			if rec.Code != test.status {
				t.Fatalf("status = %d, want %d", rec.Code, test.status)
			}
			if got := rec.Header().Get("Cache-Control"); got != test.cache {
				t.Fatalf("Cache-Control = %q, want %q", got, test.cache)
			}
			if got := rec.Body.String(); got != test.body {
				t.Fatalf("body = %q, want %q", got, test.body)
			}
		})
	}
}

func TestSpaRejectsWrites(t *testing.T) {
	s := &Server{web: fstest.MapFS{"index.html": {Data: []byte("<html></html>")}}}
	rec := httptest.NewRecorder()
	s.spa(rec, httptest.NewRequest(http.MethodPost, "/", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}
