package config

import (
	"fmt"
	"log"
	"os"
	"strings"
)

type Config struct {
	AppEnv                 string
	HTTPAddr               string
	DatabaseURL            string
	JWTAccessSecret        string
	JWTRefreshSecret       string
	AttachmentTicketSecret string
	StorageProvider        string
	LocalStorageRoot       string
	CORSAllowedOrigins     []string
}

type lookupFunc func(string) (string, bool)

func Load() (Config, error) {
	cfg, err := loadFromLookup(os.LookupEnv)
	if err != nil {
		return Config{}, err
	}

	if cfg.AppEnv == "development" {
		if cfg.JWTAccessSecret == "change-me" {
			log.Printf("warning: JWT_ACCESS_SECRET is using the default development placeholder")
		}
		if cfg.JWTRefreshSecret == "change-me" {
			log.Printf("warning: JWT_REFRESH_SECRET is using the default development placeholder")
		}
	}

	return cfg, nil
}

func loadFromLookup(lookup lookupFunc) (Config, error) {
	appEnv, err := requireEnv(lookup, "APP_ENV")
	if err != nil {
		return Config{}, err
	}
	httpAddr, err := requireEnv(lookup, "HTTP_ADDR")
	if err != nil {
		return Config{}, err
	}
	databaseURL, err := requireEnv(lookup, "DATABASE_URL")
	if err != nil {
		return Config{}, err
	}
	jwtAccessSecret, err := requireEnv(lookup, "JWT_ACCESS_SECRET")
	if err != nil {
		return Config{}, err
	}
	jwtRefreshSecret, err := requireEnv(lookup, "JWT_REFRESH_SECRET")
	if err != nil {
		return Config{}, err
	}
	attachmentTicketSecret, err := requireEnv(lookup, "ATTACHMENT_TICKET_SECRET")
	if err != nil {
		return Config{}, err
	}
	storageProvider, err := requireEnv(lookup, "STORAGE_PROVIDER")
	if err != nil {
		return Config{}, err
	}
	localStorageRoot, err := requireEnv(lookup, "LOCAL_STORAGE_ROOT")
	if err != nil {
		return Config{}, err
	}
	corsAllowedOrigins, err := requireEnv(lookup, "CORS_ALLOWED_ORIGINS")
	if err != nil {
		return Config{}, err
	}

	return Config{
		AppEnv:                 appEnv,
		HTTPAddr:               httpAddr,
		DatabaseURL:            databaseURL,
		JWTAccessSecret:        jwtAccessSecret,
		JWTRefreshSecret:       jwtRefreshSecret,
		AttachmentTicketSecret: attachmentTicketSecret,
		StorageProvider:        storageProvider,
		LocalStorageRoot:       localStorageRoot,
		CORSAllowedOrigins:     splitCommaSeparated(corsAllowedOrigins),
	}, nil
}

func requireEnv(lookup lookupFunc, key string) (string, error) {
	value, ok := lookup(key)
	if !ok || strings.TrimSpace(value) == "" {
		return "", fmt.Errorf("missing required environment variable %s", key)
	}
	return strings.TrimSpace(value), nil
}

func splitCommaSeparated(input string) []string {
	parts := strings.Split(input, ",")
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		values = append(values, trimmed)
	}
	return values
}
