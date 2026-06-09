package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCORSMiddleware_AllowsExactOrigin(t *testing.T) {
	middleware := NewCORSMiddleware([]string{"http://localhost:5173"})
	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodOptions, "http://api.example.test/auth/login", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", "content-type")

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if got, want := recorder.Code, http.StatusNoContent; got != want {
		t.Fatalf("expected status %d, got %d", want, got)
	}
	if got, want := recorder.Header().Get("Access-Control-Allow-Origin"), "http://localhost:5173"; got != want {
		t.Fatalf("expected allow-origin %q, got %q", want, got)
	}
}

func TestCORSMiddleware_AllowsWildcardLoopbackPort(t *testing.T) {
	middleware := NewCORSMiddleware([]string{"http://127.0.0.1:*"})
	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodOptions, "http://api.example.test/auth/login", nil)
	req.Header.Set("Origin", "http://127.0.0.1:45678")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", "content-type")

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if got, want := recorder.Code, http.StatusNoContent; got != want {
		t.Fatalf("expected status %d, got %d", want, got)
	}
	if got, want := recorder.Header().Get("Access-Control-Allow-Origin"), "http://127.0.0.1:45678"; got != want {
		t.Fatalf("expected allow-origin %q, got %q", want, got)
	}
}

func TestCORSMiddleware_RejectsUnknownOrigin(t *testing.T) {
	middleware := NewCORSMiddleware([]string{"http://localhost:5173", "http://127.0.0.1:*"})
	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodOptions, "http://api.example.test/auth/login", nil)
	req.Header.Set("Origin", "http://evil.example")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", "content-type")

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if got, want := recorder.Code, http.StatusNoContent; got != want {
		t.Fatalf("expected status %d, got %d", want, got)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("expected empty allow-origin, got %q", got)
	}
}
