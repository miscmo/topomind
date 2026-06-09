package config

import "testing"

func TestLoadFromLookup(t *testing.T) {
	t.Parallel()

	cfg, err := loadFromLookup(func(key string) (string, bool) {
		values := map[string]string{
			"APP_ENV":                  "development",
			"HTTP_ADDR":                ":3000",
			"DATABASE_URL":             "postgres://topomind:topomind@127.0.0.1:5432/topomind?sslmode=disable",
			"JWT_ACCESS_SECRET":        "change-me",
			"JWT_REFRESH_SECRET":       "change-me",
			"ATTACHMENT_TICKET_SECRET": "attachment-ticket-secret",
			"STORAGE_PROVIDER":         "local",
			"LOCAL_STORAGE_ROOT":       ".local/storage",
			"CORS_ALLOWED_ORIGINS":     "http://localhost:5173, http://127.0.0.1:5173",
		}
		value, ok := values[key]
		return value, ok
	})
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.DatabaseURL == "" {
		t.Fatal("expected DATABASE_URL to be loaded")
	}
	if len(cfg.CORSAllowedOrigins) != 2 {
		t.Fatalf("expected 2 CORS origins, got %d", len(cfg.CORSAllowedOrigins))
	}
}

func TestLoadFromLookupRequiresDatabaseURL(t *testing.T) {
	t.Parallel()

	_, err := loadFromLookup(func(key string) (string, bool) {
		values := map[string]string{
			"APP_ENV":                  "development",
			"HTTP_ADDR":                ":3000",
			"JWT_ACCESS_SECRET":        "change-me",
			"JWT_REFRESH_SECRET":       "change-me",
			"ATTACHMENT_TICKET_SECRET": "attachment-ticket-secret",
			"STORAGE_PROVIDER":         "local",
			"LOCAL_STORAGE_ROOT":       ".local/storage",
			"CORS_ALLOWED_ORIGINS":     "http://localhost:5173",
		}
		value, ok := values[key]
		return value, ok
	})
	if err == nil {
		t.Fatal("expected missing DATABASE_URL error")
	}
	if got, want := err.Error(), "missing required environment variable DATABASE_URL"; got != want {
		t.Fatalf("unexpected error: got %q want %q", got, want)
	}
}
