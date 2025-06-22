package main

import (
	"context"
	"encoding/json"
	"os"
	"os/signal"
	"path/filepath"

	"github.com/alecthomas/kong"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func main() {
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
	JSON    bool   `help:"Output operations in JSON format without executing"`
	Once    bool   `help:"Run the server once and exit after save" default:"true"`
	Verbose bool   `help:"Enable verbose logging" default:"false"`
}

func (cmd *serveCmd) Run() error {
	level := zerolog.InfoLevel
	if cmd.Verbose {
		level = zerolog.DebugLevel
	}
	log.Logger = log.Output(zerolog.NewConsoleWriter()).Level(level)
	zerolog.DefaultContextLogger = &log.Logger

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	ctx = log.Logger.WithContext(ctx)

	executor := &OperationExecutor{
		BaseDir:   cmd.RootDir,
		OutputDir: filepath.Join(cmd.RootDir, "output"),
		Cropper:   NewImagingCropper(),
	}

	app := NewWebApp(Config{
		RootDir: cmd.RootDir,
		OnBeforeShutdown: func() {
			log.Ctx(ctx).Info().Msg("Shutting down web application...")
		},
		OnReady: func(addr string) {
			log.Ctx(ctx).Info().Msgf("Server started at %s", addr)
			if cmd.Open {
				if err := openBrowser(addr); err != nil {
					log.Error().Err(err).Msg("Failed to open browser")
				}
			}
		},
		OnSave: func(ops Operations) {
			if cmd.JSON {
				printJSONL(ops)
			} else {
				if err := executor.Exec(ctx, ops); err != nil {
					log.Ctx(ctx).Error().Err(err).Msg("Failed to execute operations")
				}
			}

			if cmd.Once {
				cancel()
			}
		},
	})

	if err := app.Run(ctx); err != nil {
		return err
	}

	return nil
}

type cliArgs struct {
	Serve serveCmd `cmd:"" default:"withargs"`
}

func printJSONL[T any](data []T) {
	enc := json.NewEncoder(os.Stdout)
	for _, item := range data {
		if err := enc.Encode(item); err != nil {
			log.Error().Err(err).Msg("Failed to encode item to JSON")
			continue
		}
	}
}
