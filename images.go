package main

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

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

type Directory struct {
	Name  string     `json:"name"`
	Files []FileInfo `json:"files"`
}

func walkImages(rootPath string) (Directory, error) {
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
			if strings.ToLower(filepath.Ext(path)) == ext {
				info, err := d.Info()
				if err != nil {
					return fmt.Errorf("failed to get file info: %w", err)
				}

				relPath, err := filepath.Rel(rootPath, path)
				if err != nil {
					return fmt.Errorf("failed to get relative path: %w", err)
				}

				files = append(files, FileInfo{
					Name:       relPath,
					IsDir:      d.IsDir(),
					SizeBytes:  info.Size(),
					ModifiedAt: info.ModTime(),
				})
			}
		}
		return nil
	}); err != nil {
		return Directory{}, err
	}

	for i := range files {
		w, h, err := readJPEGDimensions(filepath.Join(rootPath, files[i].Name))
		if err != nil {
			log.Ctx(context.Background()).Error().Err(err).Str("filename", files[i].Name).Msg("cannot read image dimensions")
			continue
		}
		files[i].Image = ImageInfo{
			Width:  w,
			Height: h,
		}
	}

	return Directory{
		Name:  filepath.Base(rootPath),
		Files: files,
	}, nil
}

func readJPEGDimensions(filePath string) (width, height int, err error) {
	file, err := os.Open(filePath)
	if err != nil {
		return 0, 0, fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	var buf [2]byte

	// Read the first two bytes (JPEG SOI marker)
	_, err = file.Read(buf[:])
	if err != nil {
		return 0, 0, fmt.Errorf("failed to read SOI marker: %w", err)
	}
	if buf[0] != 0xFF || buf[1] != 0xD8 {
		return 0, 0, errors.New("not a valid JPEG file")
	}

	for {
		// Read the next marker
		_, err = file.Read(buf[:])
		if err != nil {
			return 0, 0, err
		}
		if buf[0] != 0xFF {
			return 0, 0, errors.New("invalid JPEG format")
		}

		// Skip padding bytes (0xFF)
		for buf[1] == 0xFF {
			_, err = file.Read(buf[1:2])
			if err != nil {
				return 0, 0, err
			}
		}

		// Check for SOF0 (Start of Frame) marker which contains the dimensions
		if buf[1] >= 0xC0 && buf[1] <= 0xC3 {
			// Read the length of the segment
			_, err = file.Read(buf[:])
			if err != nil {
				return 0, 0, err
			}
			length := binary.BigEndian.Uint16(buf[:])

			// Read the segment data
			segment := make([]byte, length-2)
			_, err = file.Read(segment)
			if err != nil {
				return 0, 0, err
			}

			// Extract height and width
			height = int(binary.BigEndian.Uint16(segment[1:3]))
			width = int(binary.BigEndian.Uint16(segment[3:5]))
			return width, height, nil
		} else {
			// Read the length of the segment
			_, err = file.Read(buf[:])
			if err != nil {
				return 0, 0, err
			}
			length := binary.BigEndian.Uint16(buf[:])

			// Skip the segment
			_, err = file.Seek(int64(length-2), os.SEEK_CUR)
			if err != nil {
				return 0, 0, err
			}
		}
	}
}
