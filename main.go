package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
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
			log.Ctx(c.Context()).Error().Err(err).Msg("Error in request")
			var fiberErr *fiber.Error
			if errors.As(err, &fiberErr) {
				return c.Status(fiberErr.Code).JSON(fiber.Map{"error": fiberErr.Message})
			}
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "Internal Server Error"})
		},
	})

	webapp.Static("/", "static")

	filesRoot := http.Dir(cmd.RootDir)

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

	webapp.Post("/api/save", func(c *fiber.Ctx) error {
		var request struct {
			Operations []Operation `json:"operations"`
		}

		if err := c.BodyParser(&request); err != nil {
			return err
		}

		for _, op := range request.Operations {
			if err := op.Run(c.Context()); err != nil {
				return err
			}
		}

		return c.SendStatus(http.StatusNoContent)
	})

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

	log.Info().Str("address", ":3001").Msg("Server started")

	if err := webapp.Listen(":3001"); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("server error: %w", err)
	}

	return nil
}

type Operation struct {
	Crop *CropOperation
	Pick *PickOperation
}

func (o Operation) Run(ctx context.Context) error {
	if o.Crop != nil {
		return o.Crop.Run(ctx)
	} else if o.Pick != nil {
		return o.Pick.Run(ctx)
	}
	return fmt.Errorf("no valid operation found")
}

// unmarshal
func (o *Operation) UnmarshalJSON(data []byte) error {
	var op struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(data, &op); err != nil {
		return fmt.Errorf("failed to unmarshal operation: %w", err)
	}

	switch op.Type {
	case "crop":
		var crop CropOperation
		if err := json.Unmarshal(data, &crop); err != nil {
			return fmt.Errorf("failed to unmarshal crop operation: %w", err)
		}
		o.Crop = &crop
	case "pick":
		var pick PickOperation
		if err := json.Unmarshal(data, &pick); err != nil {
			return fmt.Errorf("failed to unmarshal pick operation: %w", err)
		}
		o.Pick = &pick
	default:
		return fmt.Errorf("unknown operation %q", op.Type)
	}
	return nil
}

type Crop struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"w"`
	Height float64 `json:"h"`
}

type CropOperation struct {
	Filename string `json:"filename"`
	Crop     Crop   `json:"crop"`
}

func (o CropOperation) Run(ctx context.Context) error {
	log.Ctx(ctx).Info().Interface("op", o).Msg("Running crop operation")
	return nil
}

type PickOperation struct {
	Filename string `json:"filename"`
}

func (o PickOperation) Run(ctx context.Context) error {
	log.Ctx(ctx).Info().Interface("op", o).Msg("Running pick operation")
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
