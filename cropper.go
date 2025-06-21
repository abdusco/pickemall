package main

import (
	"context"
	"fmt"
	"image"
	"io"

	"github.com/disintegration/imaging"
)

// ImagingCropper is an implementation of the Cropper interface
// using the disintegration/imaging library
type ImagingCropper struct{}

// Crop implements the Cropper interface using the imaging library.
// It reads an image from r, crops it according to the specified dimensions,
// and writes the result to w.
func (c *ImagingCropper) Crop(ctx context.Context, r io.Reader, w io.Writer, crop Crop) error {
	// Decode the image from the reader
	src, err := imaging.Decode(r, imaging.AutoOrientation(true))
	if err != nil {
		return fmt.Errorf("failed to decode image: %w", err)
	}

	// Get the dimensions of the original image
	bounds := src.Bounds()
	imgWidth := bounds.Dx()
	imgHeight := bounds.Dy()

	// Convert relative crop coordinates to absolute pixel values
	x := int(crop.X * float64(imgWidth))
	y := int(crop.Y * float64(imgHeight))
	width := int(crop.Width * float64(imgWidth))
	height := int(crop.Height * float64(imgHeight))

	// Ensure crop rectangle is valid and within image bounds
	if width <= 0 || height <= 0 {
		return fmt.Errorf("invalid crop dimensions: width=%d, height=%d", width, height)
	}

	// Create the crop rectangle
	cropRect := image.Rect(x, y, x+width, y+height)

	// Ensure crop rectangle is within image bounds
	if !cropRect.In(bounds) {
		// Adjust crop rectangle to fit within image bounds
		cropRect = cropRect.Intersect(bounds)
		if cropRect.Empty() {
			return fmt.Errorf("crop rectangle is outside image bounds")
		}
	}

	// Crop the image
	croppedImg := imaging.Crop(src, cropRect)

	// Encode and write the cropped image with high quality
	return imaging.Encode(w, croppedImg, imaging.JPEG, imaging.JPEGQuality(90))
}

// NewImagingCropper creates a new instance of ImagingCropper
func NewImagingCropper() *ImagingCropper {
	return &ImagingCropper{}
}
