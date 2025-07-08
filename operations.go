package main

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"

	"github.com/rs/zerolog/log"
	"github.com/sourcegraph/conc/pool"
)

type Operations = []Operation

type Operation struct {
	Crop *CropOperation
	Pick *PickOperation
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
	// X is the x-coordinate of the top-left corner of the crop rectangle, relative to the image width (0.0 to 1.0).
	X float64 `json:"x"`
	// Y is the y-coordinate of the top-left corner of the crop rectangle, relative to the image height (0.0 to 1.0).
	Y float64 `json:"y"`
	// Width is the width of the crop rectangle, relative to the image width (0.0 to 1.0).
	Width float64 `json:"w"`
	// Height is the height of the crop rectangle, relative to the image height (0.0 to 1.0).
	Height float64 `json:"h"`
}

func (c Crop) String() string {
	return fmt.Sprintf("crop(x=%.2f,y=%.2f,w=%.2f,h=%.2f)", c.X, c.Y, c.Width, c.Height)
}

func (c Crop) ID() string {
	m := md5.New()
	_, err := m.Write([]byte(c.String()))
	if err != nil {
		log.Error().Err(err).Msg("failed to hash crop string")
		return ""
	}
	return fmt.Sprintf("%x", m.Sum(nil))
}

type CropOperation struct {
	Filename string `json:"filename"`
	Crop     Crop   `json:"crop"`
}

type PickOperation struct {
	Filename string `json:"filename"`
}

type Cropper interface {
	Crop(ctx context.Context, r io.Reader, w io.Writer, crop Crop) error
}

type OperationExecutor struct {
	BaseDir   string
	OutputDir string
	Cropper   Cropper
}

func (r OperationExecutor) Exec(ctx context.Context, ops []Operation) error {
	if len(ops) == 0 {
		log.Ctx(ctx).Warn().Msg("no operations to execute")
		return nil
	}

	pooler := pool.New().WithErrors().WithContext(ctx).WithMaxGoroutines(runtime.NumCPU())

	if err := os.MkdirAll(r.OutputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory %s: %w", r.OutputDir, err)
	}
	for _, op := range ops {
		pooler.Go(func(ctx context.Context) error {
			if err := r.executeOperation(ctx, op); err != nil {
				log.Ctx(ctx).Error().Err(err).
					Interface("op", op).
					Msg("failed to execute operation")
				return err
			}
			return nil
		})
	}

	if err := pooler.Wait(); err != nil {
		log.Ctx(ctx).Error().
			Err(err).
			Msg("finished with errors")
		return err
	}

	return nil
}

func (r OperationExecutor) executeOperation(ctx context.Context, op Operation) error {
	if op.Crop != nil {
		return r.executeCrop(ctx, *op.Crop)
	} else if op.Pick != nil {
		return r.executePick(ctx, *op.Pick)
	}
	return nil
}

func (r OperationExecutor) executeCrop(ctx context.Context, op CropOperation) error {
	log.Ctx(ctx).Info().Str("filename", op.Filename).Msg("cropping")
	sourcePath := filepath.Join(r.BaseDir, op.Filename)
	f, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("failed to open file %s: %w", sourcePath, err)
	}
	defer f.Close()
	var b bytes.Buffer
	if err := r.Cropper.Crop(ctx, f, &b, op.Crop); err != nil {
		return err
	}

	newName := fmt.Sprintf("%s-%s.jpg", filepath.Base(op.Filename), op.Crop.ID())
	croppedPath := filepath.Join(r.OutputDir, newName)
	wf, err := os.Create(croppedPath)
	if err != nil {
		return fmt.Errorf("failed to create cropped file %s: %w", newName, err)
	}
	defer wf.Close()
	if _, err := b.WriteTo(wf); err != nil {
		return fmt.Errorf("failed to write cropped data to file %s: %w", newName, err)
	}
	return nil
}

func (r OperationExecutor) executePick(ctx context.Context, op PickOperation) error {
	log.Ctx(ctx).Info().Str("filename", op.Filename).Msg("picking")
	sourcePath := filepath.Join(r.BaseDir, op.Filename)
	savePath := filepath.Join(r.OutputDir, op.Filename)
	if err := copyFile(sourcePath, savePath); err != nil {
		return fmt.Errorf("failed to pick file %s: %w", op.Filename, err)
	}
	return nil
}

func copyFile(sourcePath, destPath string) error {
	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("failed to open source file %s: %w", sourcePath, err)
	}
	defer sourceFile.Close()

	destFile, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("failed to create destination file %s: %w", destPath, err)
	}
	defer destFile.Close()

	if _, err := io.Copy(destFile, sourceFile); err != nil {
		return fmt.Errorf("failed to copy file from %s to %s: %w", sourcePath, destPath, err)
	}

	return nil
}
