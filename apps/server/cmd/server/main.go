package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"topomind/apps/server/internal/attachment"
	"topomind/apps/server/internal/auth"
	"topomind/apps/server/internal/card"
	"topomind/apps/server/internal/config"
	"topomind/apps/server/internal/db"
	"topomind/apps/server/internal/document"
	"topomind/apps/server/internal/graphlayout"
	httpapi "topomind/apps/server/internal/http"
	"topomind/apps/server/internal/importer"
	"topomind/apps/server/internal/kb"
	"topomind/apps/server/internal/storage"
	syncapi "topomind/apps/server/internal/sync"
	"topomind/apps/server/internal/syncpush"
	"topomind/apps/server/internal/workspace"
	"topomind/apps/server/internal/workspaceconfig"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	bootstrapCtx, bootstrapCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer bootstrapCancel()

	pool, err := db.NewPool(bootstrapCtx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}
	defer pool.Close()

	eventWriter := syncapi.NewEventWriter()
	authService := auth.NewService(pool, cfg.JWTAccessSecret, cfg.JWTRefreshSecret)
	authHandler := auth.NewHandler(authService)
	workspaceHandler := workspace.NewHandler(pool)
	workspaceConfigHandler := workspaceconfig.NewHandler(pool, eventWriter)
	var objectStorage *storage.LocalDisk
	switch cfg.StorageProvider {
	case "local":
		objectStorage, err = storage.NewLocalDisk(cfg.LocalStorageRoot)
		if err != nil {
			log.Fatalf("init local storage: %v", err)
		}
	default:
		log.Fatalf("unsupported STORAGE_PROVIDER %q", cfg.StorageProvider)
	}
	cardService := card.NewService(pool, eventWriter)
	documentService := document.NewService(pool, eventWriter)
	graphLayoutService := graphlayout.NewService(pool, eventWriter)
	kbService := kb.NewService(pool, eventWriter)
	attachmentService, err := attachment.NewService(
		pool,
		eventWriter,
		objectStorage,
		cfg.StorageProvider,
		cfg.AttachmentTicketSecret,
	)
	if err != nil {
		log.Fatalf("init attachment service: %v", err)
	}
	importerService, err := importer.NewService(pool, objectStorage)
	if err != nil {
		log.Fatalf("init importer service: %v", err)
	}
	importerRunner, err := importer.NewRunner(importerService)
	if err != nil {
		log.Fatalf("init importer runner: %v", err)
	}
	cardHandler := card.NewHandler(cardService)
	documentHandler := document.NewHandler(documentService)
	graphLayoutHandler := graphlayout.NewHandler(graphLayoutService)
	kbHandler := kb.NewHandler(kbService)
	attachmentHandler := attachment.NewHandler(attachmentService)
	importerHandler := importer.NewHandler(importerService)
	syncHandler := syncapi.NewHandler(syncapi.NewService(pool))
	syncPushHandler := syncpush.NewHandler(syncpush.NewService(pool, kbService, cardService, documentService, graphLayoutService))

	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(middleware.RealIP)
	router.Use(middleware.Recoverer)
	router.Use(httpapi.NewCORSMiddleware(cfg.CORSAllowedOrigins))

	router.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		if err := httpapi.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true}); err != nil {
			log.Printf("write health response: %v", err)
		}
	})

	router.Route("/auth", func(r chi.Router) {
		r.Post("/register", authHandler.Register)
		r.Post("/login", authHandler.Login)
		r.Post("/refresh", authHandler.Refresh)
	})

	router.Put("/workspaces/{workspaceId}/attachments/upload", attachmentHandler.UploadBinary)
	router.Post("/workspaces/{workspaceId}/attachments/commit", attachmentHandler.CommitUpload)

	router.Group(func(r chi.Router) {
		r.Use(auth.RequireAuth(authService))
		r.Get("/workspaces", workspaceHandler.List)
		r.Get("/workspaces/{workspaceId}/bootstrap", workspaceHandler.Bootstrap)
		r.Put("/workspaces/{workspaceId}/config", workspaceConfigHandler.Update)
		r.Post("/workspaces/{workspaceId}/knowledge-bases", kbHandler.Create)
		r.Get("/workspaces/{workspaceId}/cards", cardHandler.List)
		r.Post("/workspaces/{workspaceId}/cards", cardHandler.Create)
		r.Get("/workspaces/{workspaceId}/cards/{cardId}", cardHandler.Get)
		r.Get("/workspaces/{workspaceId}/cards/{cardId}/documents", documentHandler.List)
		r.Post("/workspaces/{workspaceId}/cards/{cardId}/documents", documentHandler.Create)
		r.Get("/workspaces/{workspaceId}/documents/{documentId}", documentHandler.Get)
		r.Patch("/workspaces/{workspaceId}/documents/{documentId}", documentHandler.Update)
		r.Post("/workspaces/{workspaceId}/documents/{documentId}/move", documentHandler.Move)
		r.Post("/workspaces/{workspaceId}/documents/{documentId}/content", documentHandler.SaveContent)
		r.Delete("/workspaces/{workspaceId}/documents/{documentId}", documentHandler.Delete)
		r.Get("/workspaces/{workspaceId}/graph-layouts/{layoutId}", graphLayoutHandler.Get)
		r.Patch("/workspaces/{workspaceId}/graph-layouts/{layoutId}", graphLayoutHandler.Save)
		r.Post("/workspaces/{workspaceId}/graph-layouts/{layoutId}/patch", graphLayoutHandler.Patch)
		r.Patch("/workspaces/{workspaceId}/cards/{cardId}", cardHandler.Update)
		r.Delete("/workspaces/{workspaceId}/cards/{cardId}", cardHandler.Delete)
		r.Post("/workspaces/{workspaceId}/cards/{cardId}/restore", cardHandler.Restore)
		r.Delete("/workspaces/{workspaceId}/cards/{cardId}/purge", cardHandler.Purge)
		r.Patch("/workspaces/{workspaceId}/knowledge-bases/{kbId}", kbHandler.Update)
		r.Delete("/workspaces/{workspaceId}/knowledge-bases/{kbId}", kbHandler.Delete)
		r.Post("/workspaces/{workspaceId}/knowledge-bases/{kbId}/restore", kbHandler.Restore)
		r.Delete("/workspaces/{workspaceId}/knowledge-bases/{kbId}/purge", kbHandler.Purge)
		r.Post("/workspaces/{workspaceId}/attachments/upload-ticket", attachmentHandler.CreateUploadTicket)
		r.Get("/workspaces/{workspaceId}/attachments/{attachmentId}/content", attachmentHandler.GetContent)
		r.Delete("/workspaces/{workspaceId}/attachments/{attachmentId}", attachmentHandler.Delete)
		r.Post("/workspaces/{workspaceId}/attachments/{attachmentId}/restore", attachmentHandler.Restore)
		r.Delete("/workspaces/{workspaceId}/attachments/{attachmentId}/purge", attachmentHandler.Purge)
		r.Post("/workspaces/{workspaceId}/imports", importerHandler.Create)
		r.Get("/workspaces/{workspaceId}/imports/{importJobId}", importerHandler.Get)
		r.Get("/workspaces/{workspaceId}/imports/{importJobId}/report", importerHandler.Report)
		r.Get("/workspaces/{workspaceId}/sync/pull", syncHandler.Pull)
		r.Post("/workspaces/{workspaceId}/sync/push", syncPushHandler.Push)
	})

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go importerRunner.Start(ctx)

	go func() {
		<-ctx.Done()

		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := server.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("shutdown server: %v", err)
		}
	}()

	log.Printf("topomind server listening on %s", cfg.HTTPAddr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("listen server: %v", err)
	}
}
