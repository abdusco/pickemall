/**
 * @typedef {object} CropData
 * @property {number} x - The x-coordinate of the crop area's top-left corner, as a fraction (0-1) of the image's width.
 * @property {number} y - The y-coordinate of the crop area's top-left corner, as a fraction (0-1) of the image's height.
 * @property {number} w - The width of the crop area, as a fraction (0-1) of the image's width.
 * @property {number} h - The height of the crop area, as a fraction (0-1) of the image's height.
 */

/**
 * A self-contained, dependency-free Image Cropper.
 */
class Cropper {
    /**
     * Creates an instance of the Cropper.
     * @param {HTMLImageElement} imgElement The image element to crop.
     * @param {object} [options] - Configuration options.
     * @param {number|null} [options.aspectRatio=null] - The desired aspect ratio (e.g., 16/9, 1, or null for freeform).
     * @param {(data: CropData) => void} [options.onCrop] - A callback function that fires whenever the crop area changes.
     * @param {(cropper: Cropper) => void} [options.onReady] - A callback that fires when the cropper is initialized.
     */
    constructor(imgElement, options = {}) {
        this.imgElement = imgElement;
        this.options = {
            aspectRatio: null,
            onCrop: () => {},
            onReady: () => {},
            ...options,
        };

        this._state = {
            isDragging: false,
            isResizing: false,
            isNewCrop: false,
            resizeDirection: "",
            startX: 0,
            startY: 0,
            cropBox: { x: 0, y: 0, width: 0, height: 0 },
            wrapperWidth: 0,
            wrapperHeight: 0,
        };

        // Bind all event handlers to the class instance
        this._bound = {
            onMouseDown: this._onMouseDown.bind(this),
            onMouseMove: this._onMouseMove.bind(this),
            onMouseUp: this._onMouseUp.bind(this),
            onResize: this._onResize.bind(this),
        };

        // Wait for the image to be fully loaded before initializing
        if (this.imgElement.complete) {
            this._init();
        } else {
            this.imgElement.onload = () => this._init();
        }
    }

    /**
     * Initializes the cropper DOM, styles, and event listeners.
     * @private
     */
    _init() {
        if (this.wrapper) return; // Already initialized

        this._injectCSS();
        this._createDOM();
        this._addEventListeners();

        const imgRect = this.wrapper.getBoundingClientRect();
        this._state.wrapperWidth = imgRect.width;
        this._state.wrapperHeight = imgRect.height;

        // Don't set an initial crop box. Let the user do it via onReady or by drawing.
        this._state.cropBox = { x: 0, y: 0, width: 0, height: 0 };
        this.selection.style.display = "none";

        this._updateUI();

        if (this.options.onReady) {
            this.options.onReady(this);
        }
    }

    /**
     * Creates the necessary DOM elements for the cropper overlay and handles.
     * @private
     */
    _createDOM() {
        // Create wrapper
        this.wrapper = document.createElement("div");
        this.wrapper.className = "cropper-wrapper";
        this.imgElement.parentNode.insertBefore(this.wrapper, this.imgElement);
        this.wrapper.appendChild(this.imgElement);

        // Make image responsive within the wrapper
        this.imgElement.style.maxWidth = "100%";
        this.imgElement.style.display = "block";

        // Create overlay
        this.overlay = document.createElement("div");
        this.overlay.className = "cropper-overlay";

        // Create selection box
        this.selection = document.createElement("div");
        this.selection.className = "cropper-selection";

        // Create resize handles
        const handles = ["nw", "ne", "sw", "se", "n", "s", "w", "e"];
        handles.forEach((dir) => {
            const handle = document.createElement("div");
            handle.className = `cropper-handle cropper-handle-${dir}`;
            handle.dataset.direction = dir;
            this.selection.appendChild(handle);
        });

        this.wrapper.appendChild(this.overlay);
        this.wrapper.appendChild(this.selection);
    }

    /**
     * Adds all necessary event listeners.
     * @private
     */
    _addEventListeners() {
        this.wrapper.addEventListener("mousedown", this._bound.onMouseDown);
        document.addEventListener("mousemove", this._bound.onMouseMove);
        document.addEventListener("mouseup", this._bound.onMouseUp);

        this.wrapper.addEventListener("touchstart", this._bound.onMouseDown, { passive: false });
        document.addEventListener("touchmove", this._bound.onMouseMove, { passive: false });
        document.addEventListener("touchend", this._bound.onMouseUp);

        // Use ResizeObserver for responsive adjustments
        this.resizeObserver = new ResizeObserver(this._bound.onResize);
        this.resizeObserver.observe(this.wrapper);
    }

    /**
     * Normalizes mouse and touch event coordinates.
     * @param {MouseEvent|TouchEvent} e
     * @returns {{clientX: number, clientY: number}}
     * @private
     */
    _getEventCoords(e) {
        return e.touches ? e.touches[0] : e;
    }

    /**
     * Handles the start of a drag or resize operation.
     * @param {MouseEvent|TouchEvent} e
     * @private
     */
    _onMouseDown(e) {
        e.preventDefault();
        const coords = this._getEventCoords(e);
        const target = e.target;

        this._state.startX = coords.clientX;
        this._state.startY = coords.clientY;
        this._state.startCropBox = { ...this._state.cropBox };

        if (target.classList.contains("cropper-handle")) {
            this._state.isResizing = true;
            this._state.resizeDirection = target.dataset.direction;
        } else if (target.classList.contains("cropper-selection")) {
            this._state.isDragging = true;
        } else {
            this.selection.style.display = "block";
            this._state.isNewCrop = true;
            const wrapperRect = this.wrapper.getBoundingClientRect();
            const x = coords.clientX - wrapperRect.left;
            const y = coords.clientY - wrapperRect.top;
            this._state.cropBox = { x, y, width: 0, height: 0 };
            this._state.startCropBox = { ...this._state.cropBox };
        }
    }

    /**
     * Handles the mouse/touch move for dragging and resizing.
     * @param {MouseEvent|TouchEvent} e
     * @private
     */
    _onMouseMove(e) {
        if (!this._state.isDragging && !this._state.isResizing && !this._state.isNewCrop) return;
        e.preventDefault();

        if (this._state.isNewCrop) this._handleNewCrop(e);
        else if (this._state.isDragging) this._handleDrag(e);
        else if (this._state.isResizing) this._handleResize(e);

        this._updateUI();
    }

    /**
     * Ends the drag/resize operation and triggers the onCrop callback.
     * @private
     */
    _onMouseUp() {
        if (this._state.isDragging || this._state.isResizing || this._state.isNewCrop) {
            this._triggerOnCrop();
        }
        this._state.isDragging = false;
        this._state.isResizing = false;
        this._state.isNewCrop = false;
    }

    /**
     * Handles responsive resizing of the cropper.
     * @private
     */
    _onResize() {
        const { cropBox, wrapperWidth, wrapperHeight } = this._state;
        const newImgRect = this.wrapper.getBoundingClientRect();

        if (wrapperWidth > 0 && wrapperHeight > 0) {
            const scaleX = newImgRect.width / wrapperWidth;
            const scaleY = newImgRect.height / wrapperHeight;

            cropBox.x *= scaleX;
            cropBox.y *= scaleY;
            cropBox.width *= scaleX;
            cropBox.height *= scaleY;
        }

        this._state.wrapperWidth = newImgRect.width;
        this._state.wrapperHeight = newImgRect.height;

        this._constrainCropBox();
        this._updateUI();
    }

    /**
     * Calculates new crop box position during drag.
     * @param {MouseEvent|TouchEvent} e
     * @private
     */
    _handleDrag(e) {
        const coords = this._getEventCoords(e);
        const deltaX = coords.clientX - this._state.startX;
        const deltaY = coords.clientY - this._state.startY;

        this._state.cropBox.x = this._state.startCropBox.x + deltaX;
        this._state.cropBox.y = this._state.startCropBox.y + deltaY;
        this._constrainCropBox();
    }

    /**
     * Calculates new crop box dimensions when creating a new crop area.
     * @param {MouseEvent|TouchEvent} e
     * @private
     */
    _handleNewCrop(e) {
        const { cropBox, startCropBox, startX, startY } = this._state;
        const coords = this._getEventCoords(e);
        const deltaX = coords.clientX - startX;
        const deltaY = coords.clientY - startY;

        let newX = startCropBox.x;
        let newY = startCropBox.y;
        let newWidth = deltaX;
        let newHeight = deltaY;

        if (newWidth < 0) {
            newX = startCropBox.x + newWidth;
            newWidth = -newWidth;
        }
        if (newHeight < 0) {
            newY = startCropBox.y + newHeight;
            newHeight = -newHeight;
        }

        // Enforce aspect ratio
        if (this.options.aspectRatio) {
            if (Math.abs(deltaX) > Math.abs(deltaY)) {
                newHeight = newWidth / this.options.aspectRatio;
            } else {
                newWidth = newHeight * this.options.aspectRatio;
            }

            // Recalculate position based on new dimensions and drag direction
            if (deltaX < 0) {
                newX = startCropBox.x - newWidth;
            }
            if (deltaY < 0) {
                newY = startCropBox.y - newHeight;
            }
        }

        cropBox.x = newX;
        cropBox.y = newY;
        cropBox.width = newWidth;
        cropBox.height = newHeight;

        this._constrainCropBox();
    }

    /**
     * Calculates new crop box dimensions during resize.
     * @param {MouseEvent|TouchEvent} e
     * @private
     */
    _handleResize(e) {
        const { cropBox, startCropBox, startX, startY, resizeDirection } = this._state;
        const coords = this._getEventCoords(e);
        const deltaX = coords.clientX - startX;
        const deltaY = coords.clientY - startY;

        let { x, y, width, height } = startCropBox;

        // Horizontal resizing
        if (resizeDirection.includes("e")) width += deltaX;
        if (resizeDirection.includes("w")) {
            width -= deltaX;
            x += deltaX;
        }

        // Vertical resizing
        if (resizeDirection.includes("s")) height += deltaY;
        if (resizeDirection.includes("n")) {
            height -= deltaY;
            y += deltaY;
        }

        // Enforce aspect ratio
        if (this.options.aspectRatio) {
            if (resizeDirection.includes("w") || resizeDirection.includes("e")) {
                height = width / this.options.aspectRatio;
            } else if (resizeDirection.includes("n") || resizeDirection.includes("s")) {
                width = height * this.options.aspectRatio;
            }
            // For corner handles, base on the larger dimension change
            if (resizeDirection.length === 2) {
                if (Math.abs(deltaX) > Math.abs(deltaY)) {
                    height = width / this.options.aspectRatio;
                } else {
                    width = height * this.options.aspectRatio;
                }
            }

            if (resizeDirection.includes("n")) y = startCropBox.y + (startCropBox.height - height);
            if (resizeDirection.includes("w")) x = startCropBox.x + (startCropBox.width - width);
        }

        cropBox.x = x;
        cropBox.y = y;
        cropBox.width = width;
        cropBox.height = height;

        this._constrainCropBox();
    }

    /**
     * Ensures the crop box does not go outside the image wrapper bounds.
     * @private
     */
    _constrainCropBox() {
        const { cropBox } = this._state;
        const imgRect = this.wrapper.getBoundingClientRect();
        const aspectRatio = this.options.aspectRatio;

        let { x, y, width, height } = cropBox;

        // Ensure minimum size, respecting aspect ratio
        let minWidth = 50;
        let minHeight = 50;
        if (aspectRatio) {
            if (minWidth / aspectRatio > minHeight) {
                minHeight = minWidth / aspectRatio;
            } else {
                minWidth = minHeight * aspectRatio;
            }
        }
        if (width < minWidth) width = minWidth;
        if (height < minHeight) height = minHeight;

        // Constrain dimensions to image boundaries, respecting aspect ratio
        if (aspectRatio) {
            const widthRatio = width / imgRect.width;
            const heightRatio = height / imgRect.height;
            if (widthRatio > 1 || heightRatio > 1) {
                if (widthRatio > heightRatio) {
                    width = imgRect.width;
                    height = width / aspectRatio;
                } else {
                    height = imgRect.height;
                    width = height * aspectRatio;
                }
            }
        } else {
            if (width > imgRect.width) width = imgRect.width;
            if (height > imgRect.height) height = imgRect.height;
        }

        // Then constrain position based on the final dimensions
        if (x < 0) x = 0;
        if (y < 0) y = 0;
        if (x + width > imgRect.width) {
            x = imgRect.width - width;
        }
        if (y + height > imgRect.height) {
            y = imgRect.height - height;
        }

        cropBox.x = x;
        cropBox.y = y;
        cropBox.width = width;
        cropBox.height = height;
    }

    /**
     * Updates the DOM elements based on the current cropBox state.
     * @private
     */
    _updateUI() {
        const { x, y, width, height } = this._state.cropBox;
        this.selection.style.transform = `translate(${x}px, ${y}px)`;
        this.selection.style.width = `${width}px`;
        this.selection.style.height = `${height}px`;

        // This clever trick uses a large box-shadow to create the dimming effect
        // outside the selection area.
        this.overlay.style.clipPath = `polygon(
                0% 0%, 100% 0%, 100% 100%, 0% 100%, 
                0% ${y}px, ${x}px ${y}px, ${x}px ${y + height}px, ${x + width}px ${y + height}px, 
                ${x + width}px ${y}px, 0 ${y}px
            )`;
    }

    /**
     * Fires the onCrop callback with fraction-based dimensions.
     * @private
     */
    _triggerOnCrop() {
        if (typeof this.options.onCrop === "function") {
            const imgRect = this.wrapper.getBoundingClientRect();
            const { x, y, width, height } = this._state.cropBox;

            this.options.onCrop({
                x: x / imgRect.width,
                y: y / imgRect.height,
                w: width / imgRect.width,
                h: height / imgRect.height,
            });
        }
    }

    hasCrop() {
        const { cropBox } = this._state;
        return cropBox.width > 0 && cropBox.height > 0;
    }

    /**
     * Creates a canvas element containing the cropped image area.
     * @private
     * @returns {HTMLCanvasElement}
     */
    _createCroppedCanvas() {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        const { naturalWidth, naturalHeight } = this.imgElement;
        const imgRect = this.wrapper.getBoundingClientRect();

        // Calculate scale between displayed image and natural image
        const scaleX = naturalWidth / imgRect.width;
        const scaleY = naturalHeight / imgRect.height;

        const { x, y, width, height } = this._state.cropBox;

        // These are the source coordinates on the original image
        const sx = x * scaleX;
        const sy = y * scaleY;
        const sWidth = width * scaleX;
        const sHeight = height * scaleY;

        canvas.width = sWidth;
        canvas.height = sHeight;

        ctx.drawImage(
            this.imgElement,
            sx,
            sy,
            sWidth,
            sHeight, // Source rectangle
            0,
            0,
            sWidth,
            sHeight // Destination rectangle
        );

        return canvas;
    }

    // --- PUBLIC API ---

    /**
     * Sets the crop area.
     * @param {CropData} data - The crop data in fractions (0-1).
     */
    setCrop(data) {
        if (!this.wrapper) {
            console.warn("Cropper is not initialized yet. Call setCrop in onReady.");
            return;
        }

        this.selection.style.display = "block";

        const imgRect = this.wrapper.getBoundingClientRect();
        const newCropBox = {
            x: data.x * imgRect.width,
            y: data.y * imgRect.height,
            width: data.w * imgRect.width,
            height: data.h * imgRect.height,
        };

        this._state.cropBox = newCropBox;
        this._constrainCropBox();
        this._updateUI();
        this._triggerOnCrop();
    }

    /**
     * Generates a base64 Data URL of the cropped image area.
     * @returns {string} The cropped image as a data URL.
     */
    crop() {
        const canvas = this._createCroppedCanvas();
        return {
            dataURL: canvas.toDataURL("image/jpeg", 0.8),
            width: canvas.width,
            height: canvas.height,
            aspectRatio: canvas.width / canvas.height,
        };
    }

    /**
     * Generates a thumbnail of the cropped area.
     * The longest edge of the thumbnail will be resized to `maxSize` pixels.
     * @param {number} maxSize The maximum size of the longest edge.
     * @returns {string} The thumbnail image as a data URL.
     */
    thumbnail(maxSize) {
        const croppedCanvas = this._createCroppedCanvas();
        const { width: sWidth, height: sHeight } = croppedCanvas;

        let thumbWidth, thumbHeight;
        if (sWidth > sHeight) {
            thumbWidth = maxSize;
            thumbHeight = (sHeight / sWidth) * maxSize;
        } else {
            thumbHeight = maxSize;
            thumbWidth = (sWidth / sHeight) * maxSize;
        }

        const thumbCanvas = document.createElement("canvas");
        const thumbCtx = thumbCanvas.getContext("2d");
        thumbCanvas.width = thumbWidth;
        thumbCanvas.height = thumbHeight;

        thumbCtx.drawImage(croppedCanvas, 0, 0, thumbWidth, thumbHeight);

        return {
            dataURL: thumbCanvas.toDataURL("image/jpeg", 0.6),
            width: thumbWidth,
            height: thumbHeight,
            aspectRatio: thumbWidth / thumbHeight,
        };
    }

    /**
     * Changes the aspect ratio of the crop box.
     * @param {number|null} ratio The new aspect ratio, or null for freeform.
     */
    setAspectRatio(ratio) {
        this.options.aspectRatio = ratio;
        if (ratio) {
            const { cropBox } = this._state;
            const imgRect = this.wrapper.getBoundingClientRect();
            const imageAspectRatio = imgRect.width / imgRect.height;

            let newWidth;
            let newHeight;

            if (ratio > imageAspectRatio) {
                newWidth = Math.floor(imgRect.width * 0.8);
                newHeight = newWidth / ratio;
            } else {
                newHeight = Math.floor(imgRect.height * 0.8);
                newWidth = newHeight * ratio;
            }

            cropBox.width = newWidth;
            cropBox.height = newHeight;

            this._constrainCropBox();
            this._updateUI();
            this._triggerOnCrop();
        }
    }

    /**
     * Removes the cropper, its DOM elements, and event listeners.
     */
    destroy() {
        // Remove event listeners
        this.selection.removeEventListener("mousedown", this._bound.onMouseDown);
        document.removeEventListener("mousemove", this._bound.onMouseMove);
        document.removeEventListener("mouseup", this._bound.onMouseUp);
        this.selection.removeEventListener("touchstart", this._bound.onMouseDown);
        document.removeEventListener("touchmove", this._bound.onMouseMove);
        document.removeEventListener("touchend", this._bound.onMouseUp);
        this.resizeObserver.disconnect();

        // Remove DOM elements
        if (this.wrapper) {
            this.wrapper.parentNode.insertBefore(this.imgElement, this.wrapper);
            this.wrapper.remove();
        }

        // Remove injected stylesheet
        const styleTag = document.getElementById("cropper-styles");
        if (styleTag) styleTag.remove();

        // Clear references
        this.wrapper = null;
        this.overlay = null;
        this.selection = null;
    }

    /**
     * Injects the necessary CSS for the cropper into the document's head.
     * @private
     */
    _injectCSS() {
        if (document.getElementById("cropper-styles")) return;

        const css = `
                .cropper-wrapper {
                    position: relative;
                    display: inline-block;
                    touch-action: none; /* Disables browser gestures like swipe-to-navigate */
                    overflow: hidden;
                }
                .cropper-overlay {
                    position: absolute;
                    top: 0; left: 0;
                    width: 100%; height: 100%;
                    background-color: rgba(0, 0, 0, 0.5);
                    pointer-events: none;
                }
                .cropper-selection {
                    position: absolute;
                    top: 0; left: 0;
                    border: 1px solid rgba(255, 255, 255, 0.7);
                    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5); /* Alternative dimming */
                    cursor: move;
                }
                /* Hide default overlay when using box-shadow for dimming */
                .cropper-overlay { background: none; }

                .cropper-handle {
                    position: absolute;
                    width: 10px;
                    height: 10px;
                    background-color: rgba(255, 255, 255, 0.8);
                    border: 1px solid #333;
                    border-radius: 50%;
                }
                .cropper-handle-nw { top: -5px; left: -5px; cursor: nwse-resize; }
                .cropper-handle-ne { top: -5px; right: -5px; cursor: nesw-resize; }
                .cropper-handle-sw { bottom: -5px; left: -5px; cursor: nesw-resize; }
                .cropper-handle-se { bottom: -5px; right: -5px; cursor: nwse-resize; }
                .cropper-handle-n { top: -5px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
                .cropper-handle-s { bottom: -5px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
                .cropper-handle-w { top: 50%; left: -5px; transform: translateY(-50%); cursor: ew-resize; }
                .cropper-handle-e { top: 50%; right: -5px; transform: translateY(-50%); cursor: ew-resize; }
            `;
        const style = document.createElement("style");
        style.id = "cropper-styles";
        style.innerHTML = css;
        document.head.appendChild(style);
    }
}
