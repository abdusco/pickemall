package main

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"time"

	"github.com/alecthomas/kong"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/filesystem"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func main() {
	log.Logger = log.Output(zerolog.NewConsoleWriter())
	zerolog.DefaultContextLogger = &log.Logger
	if err := run(); err != nil {
		log.Fatal().Err(err).Send()
	}
}

func run() error {
	var args cliArgs
	cliCtx := kong.Parse(
		&args,
		kong.Name("pickemall"),
		kong.UsageOnError(),
	)
	if err := cliCtx.Run(); err != nil {
		return err
	}

	return nil
}

type serveCmd struct {
	RootDir string `arg:"" help:"Root directory to serve files from"`
	Open    bool   `help:"Open the browser automatically when the server starts" default:"true"`
	Debug   bool   `help:"Enable debug mode"`
}

//go:embed static
var staticFS embed.FS

func (cmd *serveCmd) Run() error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	ctx = log.Logger.WithContext(ctx)

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
				return c.Status(fiberErr.Code).JSON(fiber.Map{"error": fiberErr.Message})
			}
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "Internal Server Error"})
		},
	})

	filesRoot := http.Dir(cmd.RootDir)

	webapp.Get("/favicon.ico", func(c *fiber.Ctx) error {
		return c.SendStatus(http.StatusNoContent)
	})

	webapp.Get("/api/view", func(c *fiber.Ctx) error {
		filePath := c.Query("file")
		return filesystem.SendFile(c, filesRoot, filePath)
	})

	webapp.Get("/api/ls", func(c *fiber.Ctx) error {
		dirContent, err := walkImages(cmd.RootDir)
		if err != nil {
			return fmt.Errorf("failed to walk dir: %w", err)
		}

		for i := range dirContent {
			dirContent[i].URL = "/api/view?file=" + url.QueryEscape(dirContent[i].Name)
		}

		var response struct {
			Files []FileInfo `json:"files"`
		}
		response.Files = dirContent

		return c.JSON(response)
	})

	var executor = OperationExecutor{
		BaseDir:   cmd.RootDir,
		OutputDir: filepath.Join(cmd.RootDir, "output"),
		Cropper:   NewImagingCropper(),
	}
	webapp.Post("/api/save", func(c *fiber.Ctx) error {
		var request struct {
			Operations []Operation `json:"operations"`
		}

		if err := c.BodyParser(&request); err != nil {
			return err
		}

		if err := executor.Exec(c.Context(), request.Operations); err != nil {
			log.Ctx(c.Context()).Error().Err(err).
				Msg("Failed to exec operations")
		}

		return c.SendStatus(http.StatusNoContent)
	})
	webapp.Post("/api/shutdown", func(c *fiber.Ctx) error {
		log.Ctx(c.Context()).Info().Msg("Shutdown requested")
		defer cancel()
		return c.SendStatus(http.StatusNoContent)
	})

	if cmd.Debug {
		log.Info().Msg("Debug mode enabled, serving static files from './static' directory")
		webapp.Static("/", "static")
	} else {
		log.Info().Msg("Serving static files from embedded filesystem")
		webapp.Use("/", filesystem.New(filesystem.Config{
			Root:       http.FS(staticFS),
			PathPrefix: "/static",
		}))
	}

	// Set up the graceful shutdown in a separate goroutine
	go func() {
		<-ctx.Done() // Wait for interrupt signal (Ctrl+C)
		log.Info().Msg("Shutting down server...")

		// Give the server 5 seconds to finish processing ongoing requests
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer shutdownCancel()

		if err := webapp.ShutdownWithContext(shutdownCtx); err != nil {
			log.Error().Err(err).Msg("Server shutdown failed")
		} else {
			log.Info().Msg("Server gracefully stopped")
		}
	}()

	// Let the OS assign a random available port
	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", 0))
	if err != nil {
		return fmt.Errorf("failed to listen: %w", err)
	}

	// Extract the actual port that was assigned by the OS
	actualPort := listener.Addr().(*net.TCPAddr).Port
	serveURL := fmt.Sprintf("http://localhost:%d", actualPort)
	log.Info().Msgf("Server started at %s", serveURL)

	if cmd.Open {
		go func() {
			if err := openBrowser(serveURL); err != nil {
				log.Error().Err(err).Msg("Failed to open browser")
			}
		}()
	}

	// Use the listener that was already created
	if err := webapp.Listener(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("server error: %w", err)
	}

	return nil
}

type ImageInfo struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

type FileInfo struct {
	Name       string    `json:"name"`
	IsDir      bool      `json:"is_dir"`
	SizeBytes  int64     `json:"size_bytes"`
	ModifiedAt time.Time `json:"modified_at"`
	URL        string    `json:"url"`
	Image      ImageInfo `json:"image"`
}

func walkImages(rootPath string) ([]FileInfo, error) {
	extensions := []string{".jpg", ".jpeg"}
	var files []FileInfo

	if err := filepath.WalkDir(rootPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}

		for _, ext := range extensions {
			if filepath.Ext(path) == ext {
				info, err := d.Info()
				if err != nil {
					return fmt.Errorf("failed to get file info: %w", err)
				}

				files = append(files, FileInfo{
					Name:       d.Name(),
					IsDir:      d.IsDir(),
					SizeBytes:  info.Size(),
					ModifiedAt: info.ModTime(),
				})
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}

	for i := range files {
		w, h, err := readJPEGDimensions(filepath.Join(rootPath, files[i].Name))
		if err != nil {
			log.Ctx(context.Background()).Error().Err(err).Str("file_name", files[i].Name).Msg("cannot read image dimensions")
			continue
		}
		files[i].Image = ImageInfo{
			Width:  w,
			Height: h,
		}
	}

	return files, nil
}

type cliArgs struct {
	Serve serveCmd `cmd:"" default:"withargs"`
}
