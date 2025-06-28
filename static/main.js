const ASPECT_RATIOS = [
    {label: "Freeform", value: null},
    {label: "10:16", value: 10 / 16},
    {label: "2:3", value: 2 / 3},
    {label: "3:4", value: 3 / 4},
    {label: "4:5", value: 4 / 5},
    {label: "1:1", value: 1},
    {label: "16:10", value: 16 / 10},
];

const cropperApp = () => ({
    cropData: null,
    images: [],
    currentImage: null,
    holdingAlt: false,
    lastAspectRatio: 2 / 3,
    customAspectRatio: "",
    busy: false,
    aspectRatios: ASPECT_RATIOS,
    operations: [],
    isFullScreen: false,
    hasOverlay: false,
    async setCustomAspectRatio() {
        const parts = this.customAspectRatio.split(/[:\/]/).map(Number);
        if (parts.length === 2) {
            const [x, y] = parts;
            if (x > 0 && y > 0) {
                this.setAspectRatio(x / y);
            }
        }
    },
    /** @param {KeyboardEvent} e */
    async onHotkey(e) {
        if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
            return;
        }

        const run = async (fn) => {
            e.preventDefault();
            return fn?.();
        };

        // NOTE: modifiers should be sorted alphabetically.
        const hotkeyMap = {
            'KeyF': () => this.onEnterFullScreen(),
            'KeyC': () => this.onCropImage(),
            'KeyP': () => this.onPickImage(),
            'KeyO': () => this.onToggleOverlay(),
            'KeyJ': () => this.onNextImage(),
            'KeyK': () => this.onPreviousImage(),
            'Control+KeyZ': () => this.onUndoLastOperation(),

            'Control+Enter': () => this.onSave(),
            'Alt+Enter': () => this.onSave(),
            'Meta+Enter': () => this.onSave(),
        };

        // Handle digit keys for aspect ratios (no modifiers)
        if (e.code.startsWith('Digit')) {
            const i = +e.key;
            return run(() => this.setAspectRatio(ASPECT_RATIOS[i].value || null));
        }

        let combo = '';
        if (e.altKey) combo += 'Alt+';
        if (e.ctrlKey) combo += 'Control+';
        if (e.metaKey) combo += 'Meta+';
        if (e.shiftKey) combo += 'Shift+';
        combo += e.code;

        // Execute the callback if it exists in the map
        await run(hotkeyMap[combo]);
    },
    async onToggleOverlay() {
        if (!this.cropper) {
            return;
        }

        if (this.hasOverlay) {
            this.cropper.removeOverlays();
            this.hasOverlay = false;
        } else {
            this.cropper.addOverlay({aspectRatio: 9 / 16, className: 'overlay'});
            this.hasOverlay = true;
        }
    },
    async onUndoLastOperation() {
        this.operations.shift();
    },
    async onEnterFullScreen() {
        if (document.fullscreenElement) {
            await document.exitFullscreen();
            this.isFullScreen = false;
        } else {
            await document.documentElement.requestFullscreen();
            this.isFullScreen = true;
        }
    },
    /** @param {ImageFile} img */
    async onThumbnailClicked(img) {
        this.$refs.img.onload = () => this.initCropper();
        this.currentImage = img;
        document.querySelector(`[data-img-id="${img.id}"]`)?.scrollIntoView();
        this.hasOverlay = false;
    },
    /** @param {Operation} operation */
    async onDeleteOperation(operation) {
        this.operations = this.operations.filter((op) => op.id !== operation.id);
    },
    initCropper() {
        this.cropData = null; // Reset crop data
        this.cropper?.destroy(); // Destroy any existing cropper instance
        this.cropper = new Cropper(this.$refs.img, {
            aspectRatio: this.lastAspectRatio,
            onReady: (cropper) => {
            },
            onCrop: (data) => {
                this.cropData = {
                    x: +data.x.toFixed(3),
                    y: +data.y.toFixed(3),
                    w: +data.w.toFixed(3),
                    h: +data.h.toFixed(3),
                };
            },
        });
    },
    async onNextImage() {
        const currentIndex = this.images.findIndex((img) => img.url === this.currentImage.url);
        if (currentIndex >= this.images.length - 1) {
            return;
        }
        const nextIndex = (currentIndex + 1) % this.images.length;
        await this.onThumbnailClicked(this.images[nextIndex]);
    },
    async onPreviousImage() {
        const currentIndex = this.images.findIndex((img) => img.url === this.currentImage.url);
        if (currentIndex <= 0) {
            return;
        }
        const prevIndex = (currentIndex - 1 + this.images.length) % this.images.length;
        await this.onThumbnailClicked(this.images[prevIndex]);
    },
    async onCropImage() {
        if (!this.cropper?.hasCrop()) {
            return;
        }
        const maxLength = 600;
        const {dataURL} = this.cropper.thumbnail(maxLength);

        const newOp = new Operation({
            type: "crop",
            crop: this.cropData,
            image: {
                ...this.currentImage,
                url: dataURL,
            },
        });

        if (this.operations.find(op => op.equals(newOp))) {
            return;
        }
        this.operations = [
            newOp,
            ...this.operations,
        ];
    },
    async onOperationClicked(op) {
        const img = op.image;
        await this.onThumbnailClicked(img);
    },
    async onPickImage() {
        let newOp = new Operation({
            type: "pick",
            image: this.currentImage,
        });
        if (this.operations.find(op => op.equals(newOp))) {
            return;
        }
        this.operations = [
            newOp,
            ...this.operations,
        ];
    },
    /** @param {string} title - The title to set. */
    setTitle(title) {
        document.title = title;
    },
    async init() {
        const res = await fetchJSON('/api/ls');
        this.setTitle(res.name);
        this.images = res.files.map(f => new ImageFile(f));

        this.currentImage = this.images[0];
        await this.$nextTick();
        this.$refs.img.onload = () => {
            this.initCropper();
        };

        // Add beforeunload event listener to handle tab closing
        window.addEventListener('beforeunload', this.handleBeforeUnload);
    },
    /**
     * Sets the aspect ratio for the cropper.
     * @param {number} ratio - The aspect ratio to set (e.g., 16/9, 4/3).
     */
    setAspectRatio(ratio) {
        this.lastAspectRatio = ratio;
        if (this.cropper) {
            this.cropper.setAspectRatio(ratio);
        }
    },
    /**
     * @typedef T
     * @param {() => Promise<T>} callback
     * @returns {Promise<T>}
     * */
    async spin(callback) {
        this.busy = true;
        try {
            await callback();
        } catch (error) {
            console.error("Error during operation:", error);
            alert("An error occurred: " + error.message);
        } finally {
            this.busy = false;
        }
    },
    async onSave() {
        if (this.operations.length === 0) {
            return;
        }
        const payload = this.operations.map(op => ({
            type: op.type,
            filename: op.image.name,
            crop: op.crop,
        }));
        await this.spin(async () => {
            await fetchJSON('/api/save', {
                method: 'POST',
                body: JSON.stringify({
                    operations: payload,
                }),
            });
            await this.shutdown();
        })
    },
    async handleBeforeUnload() {
        // Use Beacon API to send the shutdown request when the tab is closing
        navigator.sendBeacon('/api/shutdown');
    },
    async shutdown() {
        await fetchJSON('/api/shutdown', {method: 'POST'});
        window.close();
    }
});


/**
 * @param {string} url
 * @param {RequestInfo} req
 * */
async function fetchJSON(url, req = {}) {
    try {
        const res = await fetch(url, {
            method: req.method ?? 'GET',
            headers: {
                'content-type': 'application/json',
                ...req.headers ?? {},
            },
            ...req,
        });
        if (!res.ok) {
            console.error('request failed', await res.text());
            return
        }

        if (!res.headers.get('content-type')?.includes('application/json')) {
            return
        }

        return await res.json();
    } catch (e) {
        console.error('fetch error', e);
    }
}

class Operation {
    /**
     * @param {Object} params
     * @param {string} params.type - Type of operation (e.g., "crop", "pick")
     * @param {ImageInfo} params.image - Image object with a URL
     * @param {CropData} params.crop - Crop data with x, y, w, h properties
     */
    constructor({type, image, crop}) {
        this.id = crypto.randomUUID();
        this.type = type;
        this.image = image;
        this.crop = crop;
    }

    equals(other) {
        if (!(other instanceof Operation)) {
            return false;
        }
        if (this.id === other.id) {
            return true;
        }

        return this.type === other.type &&
            this.image.url === other.image.url &&
            JSON.stringify(this.crop) === JSON.stringify(other.crop);
    }
}

/**
 * @typedef {{width: number; height: number}} ImageInfo
 * */
class ImageFile {
    /**
     * @param {Object} params
     * @param {string} params.name - Name of the image file
     * @param {string} params.url - URL to access the image
     * @param {ImageInfo} params.image - Image dimensions (width, height)
     */
    constructor({name, url, image}) {
        this.id = crypto.randomUUID();
        this.name = name;
        this.url = url;
        this.image = image; // {width, height}
        this.aspectRatio = image.width / image.height;
    }

    get resolution() {
        return `${this.image.width}x${this.image.height}`;
    }

    get orientation() {
        return this.aspectRatio > 1 ? 'landscape' : 'portrait';
    }
}
