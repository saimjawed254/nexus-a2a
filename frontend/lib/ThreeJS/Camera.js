import * as THREE from "three";
import Orchestrator from "./Orchestrator.js";
import GUI from "lil-gui";

export default class Camera {
    constructor() {
        this.orchestrator = new Orchestrator();
        this.sizes = this.orchestrator.sizes;
        this.scene = this.orchestrator.scene;
        this.canvas = this.orchestrator.canvas;

        // Orbit parameters
        this.radius = 12;

        // Max mouse influence in radians
        // mouse Y → rotation around X axis (up/down tilt)
        // mouse X → rotation around Z axis (left/right orbit)
        this.alphaRange = Math.PI * 0.03; // ±~14° around X
        this.betaRange = Math.PI * 0.05; // ±~22° around Z

        // Normalized mouse [-1, 1] and its lerped counterpart
        this.mouse = new THREE.Vector2(0, 0);
        this.lerpedMouse = new THREE.Vector2(0, 0);

        this.setInstance();
        this.setMouseListener();
        this.setGUI();
    }

    setInstance() {
        this.instance = new THREE.PerspectiveCamera(
            40,
            this.sizes.width / this.sizes.height,
            0.1,
            200,
        );
        this._updatePosition(0, 0);
        this.scene.add(this.instance);
    }

    setMouseListener() {
        window.addEventListener("mousemove", (e) => {
            this.mouse.x = (e.clientX / this.sizes.width) * 2 - 1;
            this.mouse.y = -(e.clientY / this.sizes.height) * 2 + 1;
        });
    }

    _updatePosition(mx, my) {
        // α: rotation around X axis (mouse Y)
        // β: rotation around Z axis (mouse X)
        const alpha = my * this.alphaRange;
        const beta = mx * this.betaRange;

        // Start at (0, r, 0), apply X rotation then Z rotation:
        // After X: (0, r·cosα, r·sinα)
        // After Z: (-r·cosα·sinβ, r·cosα·cosβ, r·sinα)
        this.instance.position.set(
            -this.radius * Math.cos(alpha) * Math.sin(beta),
            this.radius * Math.cos(alpha) * Math.cos(beta),
            this.radius * Math.sin(alpha),
        );
        this.instance.up.set(0, 0, -1);
        this.instance.lookAt(0, 0, 0);
    }

    resize() {
        this.instance.aspect = this.sizes.width / this.sizes.height;
        this.instance.updateProjectionMatrix();
    }

    update() {
        // Lerp mouse toward actual cursor position
        this.lerpedMouse.x += (this.mouse.x - this.lerpedMouse.x) * 0.04;
        this.lerpedMouse.y += (this.mouse.y - this.lerpedMouse.y) * 0.04;
        this._updatePosition(this.lerpedMouse.x, this.lerpedMouse.y);
        // this.controls.update();
    }

    setGUI() {
        this.gui = this.orchestrator.debug.ui;
        if (!this.gui) return;
        const camFolder = this.gui.addFolder("Camera");

        camFolder.add(this, "radius", 10, 20, 0.01).name("Distance");
    }
}
