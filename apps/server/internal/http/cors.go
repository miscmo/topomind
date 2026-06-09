package httpapi

import (
	"net/http"
	"net/url"
	"strings"
)

func NewCORSMiddleware(origins []string) func(http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(origins))
	patterns := make([]string, 0, len(origins))
	allowAll := false

	for _, origin := range origins {
		trimmed := strings.TrimSpace(origin)
		if trimmed == "" {
			continue
		}
		if trimmed == "*" {
			allowAll = true
			continue
		}
		if strings.HasSuffix(trimmed, ":*") {
			patterns = append(patterns, trimmed)
			continue
		}
		allowed[trimmed] = struct{}{}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := strings.TrimSpace(r.Header.Get("Origin"))
			if origin != "" && (allowAll || isAllowedOrigin(origin, allowed, patterns)) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Max-Age", "300")
			}

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func isAllowedOrigin(origin string, allowed map[string]struct{}, patterns []string) bool {
	_, ok := allowed[origin]
	if ok {
		return true
	}
	for _, pattern := range patterns {
		if wildcardOriginMatch(origin, pattern) {
			return true
		}
	}
	return false
}

func wildcardOriginMatch(origin string, pattern string) bool {
	base := strings.TrimSuffix(pattern, ":*")
	originURL, err := url.Parse(origin)
	if err != nil {
		return false
	}
	baseURL, err := url.Parse(base)
	if err != nil {
		return false
	}
	if originURL.Scheme != baseURL.Scheme {
		return false
	}
	if !strings.EqualFold(originURL.Hostname(), baseURL.Hostname()) {
		return false
	}
	return originURL.Port() != ""
}
