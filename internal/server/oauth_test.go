package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/modelsphere/console/internal/iam"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	k8stesting "k8s.io/client-go/testing"
)

func TestTokenUserReadFailureIsAServerError(t *testing.T) {
	for _, cause := range []error{
		context.DeadlineExceeded,
		errors.New("connection refused"),
		apierrors.NewForbidden(iam.UsersGVR.GroupResource(), "admin", errors.New("access denied")),
		apierrors.NewUnauthorized("cluster credentials expired"),
	} {
		t.Run(cause.Error(), func(t *testing.T) {
			srv := testServer(t)
			dyn := srv.kube.Dynamic().(*dynamicfake.FakeDynamicClient)
			dyn.PrependReactor("get", "users", func(k8stesting.Action) (bool, runtime.Object, error) {
				return true, nil, cause
			})
			var logs bytes.Buffer
			srv.log = slog.New(slog.NewJSONHandler(&logs, nil))
			form := url.Values{"grant_type": {"password"}, "username": {"admin"}, "password": {"test-password"}}
			req := httptest.NewRequest("POST", "/oauth/token", strings.NewReader(form.Encode()))
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			rec := httptest.NewRecorder()
			srv.Handler().ServeHTTP(rec, req)
			var body map[string]string
			decodeErr := json.Unmarshal(rec.Body.Bytes(), &body)
			if rec.Code != http.StatusInternalServerError || decodeErr != nil || len(body) != 1 || body["error"] != "server_error" {
				t.Fatalf("token response = %d %s; want generic server_error", rec.Code, rec.Body.String())
			}
			var entry map[string]any
			logErr := json.NewDecoder(&logs).Decode(&entry)
			loggedCause, _ := entry["err"].(string)
			if logErr != nil || !strings.Contains(loggedCause, cause.Error()) || strings.Contains(loggedCause, "test-password") {
				t.Fatalf("logs should preserve the cause without the password: %s", logs.String())
			}
			records, err := srv.store.ListLoginRecords(t.Context(), "admin")
			if err != nil || len(records) != 1 || records[0].Spec.Success || records[0].Spec.Reason != "login service failed" {
				t.Fatalf("login audit = %v, %v; want a service failure", records, err)
			}
		})
	}
}

func TestTokenCredentialFailuresStayIndistinguishable(t *testing.T) {
	srv := testServer(t)
	for _, credentials := range [][2]string{{"admin", "wrong"}, {"missing", "wrong"}, {"", "wrong"}, {"admin", ""}} {
		form := url.Values{"grant_type": {"password"}, "username": {credentials[0]}, "password": {credentials[1]}}
		req := httptest.NewRequest("POST", "/oauth/token", strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)
		var body map[string]string
		decodeErr := json.Unmarshal(rec.Body.Bytes(), &body)
		if rec.Code != http.StatusUnauthorized || decodeErr != nil || len(body) != 1 || body["error"] != "invalid_grant" {
			t.Fatalf("token response = %d %s; want generic invalid_grant", rec.Code, rec.Body.String())
		}
	}
}
