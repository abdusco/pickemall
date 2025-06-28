package main

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/filesystem"
	"github.com/rs/zerolog/log"
)

//go:embed static
var staticFS embed.FS
var isDebug = os.Getenv("DEBUG") == "1"

type Config struct {
	RootDir          string
	OnBeforeShutdown func()
	OnReady          func(addr string)
	OnSave           func(ops Operations)
}

type WebApp struct {
	config       Config
	shutdownCh   chan struct{}
	shutdownOnce sync.Once
}

func NewWebApp(config Config) *WebApp {
	return &WebApp{
		config:     config,
		shutdownCh: make(chan struct{}),
	}
}

func (a *WebApp) Shutdown() {
	a.shutdownOnce.Do(func() {
		close(a.shutdownCh)
	})
}

func (a *WebApp) Run(ctx context.Context) error {
	webapp := fiber.New(fiber.Config{
		Immutable:             true,
		DisableStartupMessage: true,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			log.Ctx(c.Context()).Error().
				Err(err).
				Str("path", c.Path()).
				Str("method", c.Method()).
				Msg("Request failed")
			var fiberErr *fiber.Error
			if errors.As(err, &fiberErr) {
				if fiberErr.Code == http.StatusNotFound && c.Path() == "/favicon.ico" {
					return nil
				}
				return c.Status(fiberErr.Code).JSON(fiber.Map{"error": fiberErr.Message})
			}
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "Internal Server Error"})
		},
	})

	webapp.Hooks().OnListen(func(listen fiber.ListenData) error {
		if fn := a.config.OnReady; fn != nil {
			fn(fmt.Sprintf("http://%s:%s", listen.Host, listen.Port))
		}
		return nil
	})

	go func() {
		select {
		case <-ctx.Done():
		case <-a.shutdownCh:
		}
		if fn := a.config.OnBeforeShutdown; fn != nil {
			fn()
		}
		if err := webapp.ShutdownWithTimeout(5 * time.Second); err != nil {
			log.Ctx(ctx).Error().Err(err).Msg("Failed to shutdown web application")
		}
	}()

	filesRoot := http.Dir(a.config.RootDir)
	webapp.Get("/api/view", func(c *fiber.Ctx) error {
		filePath := c.Query("file")
		return filesystem.SendFile(c, filesRoot, filePath)
	})

	webapp.Get("/api/ls", func(c *fiber.Ctx) error {
		dir, err := walkImages(a.config.RootDir)
		if err != nil {
			return fmt.Errorf("failed to walk dir: %w", err)
		}

		for i := range dir.Files {
			dir.Files[i].URL = "/api/view?file=" + url.QueryEscape(dir.Files[i].Name)
		}

		var response struct {
			Name  string     `json:"name"`
			Files []FileInfo `json:"files"`
		}
		response.Name = dir.Name
		response.Files = dir.Files

		return c.JSON(response)
	})

	webapp.Post("/api/save", func(c *fiber.Ctx) error {
		var request struct {
			Operations []Operation `json:"operations"`
		}

		if err := c.BodyParser(&request); err != nil {
			return err
		}

		a.config.OnSave(request.Operations)

		return c.SendStatus(http.StatusNoContent)
	})
	webapp.Post("/api/shutdown", func(c *fiber.Ctx) error {
		a.Shutdown()
		return nil
	})

	if isDebug {
		log.Debug().Msg("Debug mode enabled, serving static files from './static' directory")
		webapp.Static("/", "static")
	} else {
		log.Debug().Msg("Serving static files from embedded filesystem")
		webapp.Use("/", filesystem.New(filesystem.Config{
			Root:       http.FS(staticFS),
			PathPrefix: "/static",
		}))
	}

	// Let the OS assign a random available port
	listener, err := net.Listen("tcp", fmt.Sprintf("localhost:%d", 0))
	if err != nil {
		return fmt.Errorf("failed to listen: %w", err)
	}

	// Use the listener that was already created
	if err := webapp.Listener(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("server error: %w", err)
	}

	return nil
}
