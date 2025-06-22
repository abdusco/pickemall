![logo](./docs/logo.svg)

# pickemall

**pickemall** is a simple web-based image culling and cropping tool. 

---

## Features

- Serve a directory of images via a web interface
- Interactive image cropping with drag-resize handles
- Support for fixed or freeform aspect ratios
- Thumbnail previews of cropped & picked images
- Batch save cropped and picked images to an output folder
- Keyboard shortcuts for cropping, picking, and navigating images
- Graceful server shutdown triggered from the web UI or Ctrl+C
- Embedded web frontend with no additional build process needed

---

## Installation

To install dependencies and build:

```bash
go mod download
go build -o pickemall
```

---

## Usage

```bash
./pickemall serve /path/to/images
```

- `serve` starts the web server.
- Provide the root directory path containing your JPEG images.

### Command-line flags for serve

- `--open` (default: true): Automatically open the web browser when the server starts.
- `--debug`: Enable debug mode. In debug mode, static frontend files are served from the local `./static` directory instead of embedded assets, useful when making frontend changes.
