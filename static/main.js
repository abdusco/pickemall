const images = Array.from({length: 20}, (_, i) => {
    let aspectRatios = [2 / 3, 3 / 2];
    let aspectRatio = aspectRatios[Math.floor(Math.random() * aspectRatios.length)];

    const maxLength = 1500;
    const maxThumbLength = 200;
    let w, h;
    let thumbW, thumbH;
    if (aspectRatio > 1) {
        w = maxLength;
        h = Math.floor(w / aspectRatio);
        thumbW = maxThumbLength;
        thumbH = Math.floor(thumbW / aspectRatio);
    } else {
        h = maxLength;
        w = Math.floor(h * aspectRatio);
        thumbH = maxThumbLength;
        thumbW = Math.floor(thumbH * aspectRatio);
    }

    const id = 100 + Math.floor(Math.random() * 100) + i;

    return {
        url: `https://unsplash.it/id/${id}/${w}/${h}`,
        thumbnailURL: `https://unsplash.it/id/${id}/${thumbW}/${thumbH}`,
    };
});

const cropperApp = () => ({
    cropData: null,
    images: [],
    currentImage: null,
    holdingAlt: false,
    lastAspectRatio: null,
    customAspectRatio: "",
    aspectRatios: [
        {label: "Freeform", value: null},
        {label: "10:16", value: 10 / 16},
        {label: "2:3", value: 2 / 3},
        {label: "3:4", value: 3 / 4},
        {label: "4:5", value: 4 / 5},
        {label: "1:1", value: 1},
        {label: "16:10", value: 16 / 10},
    ],
    operations: [],
    onResizeWindow() {
        this.viewport = {
            width: window.innerWidth,
            height: window.innerHeight,
        };
    },
    async setCustomAspectRatio() {
        const parts = this.customAspectRatio.split(/[:\/]/).map(Number);
        if (parts.length === 2) {
            const [x, y] = parts;
            if (x > 0 && y > 0) {
                this.setAspectRatio(x / y);
            }
        }
    },
    async onHotkey(e) {
        if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
            return;
        }
        if (+e.key) {
            const ratio = this.aspectRatios.find((r, i) => i === +e.key);
            if (ratio) {
                e.preventDefault();
                this.setAspectRatio(ratio.value);
            } else {
                this.setAspectRatio(null); // Reset to freeform if no valid ratio
            }
        }
        if (e.altKey) {
            const ops = {
                KeyC: () => this.onCropImage(),
                KeyP: () => this.onPickImage(),
                KeyJ: () => this.onNextImage(),
                KeyK: () => this.onPreviousImage(),
            };
            const fn = ops[e.code];
            if (fn) {
                e.preventDefault();
                fn();
            }
        }
    },
    async onThumbnailClicked(img) {
        this.$refs.img.onload = () => this.initCropper();
        this.currentImage = img;
    },
    async onDeleteOperation(operation) {
        this.operations = this.operations.filter((op) => op.id !== operation.id);
    },
    initCropper() {
        this.cropData = null; // Reset crop data
        this.cropper?.destroy(); // Destroy any existing cropper instance
        this.cropper = new Cropper(this.$refs.img, {
            aspectRatio: this.lastAspectRatio,
            onReady: (cropper) => {},
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
        const maxLength = 200;
        const {dataURL, aspectRatio} = this.cropper.thumbnail(maxLength);
        this.operations = [
            ...this.operations,
            {
                id: crypto.randomUUID(),
                type: "crop",
                crop: this.cropData,
                image: this.currentImage,
                aspectRatio,
            },
        ];
    },
    async onPickImage() {
        const aspectRatio = this.$refs.img.naturalWidth / this.$refs.img.naturalHeight;

        this.operations = [
            ...this.operations,
            {
                id: crypto.randomUUID(),
                type: "pick",
                image: this.currentImage,
                aspectRatio,
            },
        ];
    },
    async init() {
        const res = await fetchJSON('/api/ls');
        this.images = res.files;

        this.onResizeWindow();
        this.currentImage = this.images[0];
        await this.$nextTick();
        this.$refs.img.onload = () => {
            this.initCropper();
        };
    },
    setAspectRatio(ratio) {
        this.lastAspectRatio = ratio;
        if (this.cropper) {
            this.cropper.setAspectRatio(ratio);
        }
    },
    cropImage() {
        if (this.cropper) {
            const dataUrl = this.cropper.crop();
            this.$refs.croppedResult.src = dataUrl;
            this.$refs.croppedResult.style.display = "block";
        }
    },
    handleFileUpload(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                this.$refs.img.src = e.target.result;
                // Initialize cropper after image is loaded
                this.$refs.img.onload = () => {
                    this.init();
                };
            };
            reader.readAsDataURL(file);
        }
    },
    resetCropper() {
        if (this.cropper) {
            this.cropper.destroy();
            this.cropData = null;
        }
    },
    async onSave() {
        debugger;
        const payload = this.operations.map(op => ({
            type: op.type,
            filename: op.image.name,
            crop: op.crop,
        }));
        await fetchJSON('/api/save', {
            method: 'POST',
            body: JSON.stringify({
                operations: payload,
            }),
        })
    }
});


/**
 * @param {string} url
 * @param {RequestInfo} req
 * */
async function fetchJSON(url, req = {}) {
    const res = await fetch(url, {
        method: req.method ?? 'GET',
        headers: {
            'content-type': 'application/json',
            ...req.headers ?? {},
        },
        ...req,
    });
    if (!res.ok) {
        throw new Error(await res.text());
    }

    if (!res.headers.get('content-type')?.includes('application/json')) {
        return
    }

    return await res.json();
}
