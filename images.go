package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"os"
)

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
