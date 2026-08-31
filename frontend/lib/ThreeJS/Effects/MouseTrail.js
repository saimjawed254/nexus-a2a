import * as THREE from "three";
import Orchestrator from "../Orchestrator.js";

// Maximum number of trail points kept alive at once.
// Must match the literal "128" used in the vertex shader texture lookup.
const MAX_TRAIL = 128;

/**
 * MouseTrail
 *
 * Records a mouse trail in world space and uploads it every frame as a
 * MAX_TRAIL×1 RGBA float DataTexture.  Each texel encodes one trail point:
 *   .r = world X
 *   .g = world Z
 *   .b = age (seconds since the point was created)
 *   .a = unused
 *
 * The vertex shader in World.js reads this texture and, for every cube,
 * sums the wave contributions from each live trail point:
 *   - an outward-expanding Gaussian envelope centred on the wavefront
 *   - cosine oscillation relative to the wavefront position
 *   - exponential time-fade and 1/(1+dist) distance attenuation
 *
 * Public API
 * ----------
 *   uniforms  – object whose entries can be directly assigned to
 *               shader.uniforms inside onBeforeCompile
 *   params    – tweak { fadeTime, trailSpacing };
 *               GUI onChange handlers should also update
 *               the corresponding uniform.value (see World.js setGUI)
 *   update(delta)  – call once per frame with delta in seconds
 *   dispose()      – removes event listeners and frees the texture
 */
export default class MouseTrail {
    constructor(bounds) {
        this.orchestrator = new Orchestrator();
        this.camera = this.orchestrator.camera.instance;
        this.canvas = this.orchestrator.canvas;
        this.bounds = bounds;

        this.params = {
            fadeTime: 2.0, // seconds for amplitude to fall to ~37 %
            trailSpacing: 0.1, // minimum world-unit distance between trail points
        };

        this.trail = []; // [ { x, z, age } ]
        this.lastPoint = null;

        // Timer-related properties for random points
        this.timeSinceLastMove = 0;
        this.randomPointTimer = 0;
        this.isPlacingRandomPoints = true; // Start with random points immediately
        this.randomPointStrength = 0.8; // gets assigned as distDelta, with a small random variation

        this.mouseCoords = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();

        // Invisible horizontal plane for pointer → world-space raycasting
        this.rayPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(bounds, bounds),
            new THREE.MeshBasicMaterial({
                side: THREE.DoubleSide,
                visible: false,
            }),
        );
        this.rayPlane.rotation.x = -Math.PI / 2;
        this.rayPlane.updateMatrixWorld(true);

        // DataTexture (MAX_TRAIL × 1, RGBA float): trail data for the shader
        this.trailData = new Float32Array(MAX_TRAIL * 4);
        this.trailTexture = new THREE.DataTexture(
            this.trailData,
            MAX_TRAIL,
            1,
            THREE.RGBAFormat,
            THREE.FloatType,
        );
        this.trailTexture.needsUpdate = true;

        // Uniform objects — assigned by reference in World.js onBeforeCompile
        // so mutations here are automatically reflected in the shader each frame.
        this._uniforms = {
            uTrailTexture: { value: this.trailTexture },
            uTrailCount: { value: 0 },
            uFadeTime: { value: this.params.fadeTime },
        };

        // Pointer event rect caching
        this.rect = this.canvas.getBoundingClientRect();
        this.orchestrator.sizes.emitter.on("resize", () => {
            this.rect = this.canvas.getBoundingClientRect();
        });

        this.bindPointerEvents();
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    get uniforms() {
        return this._uniforms;
    }

    /**
     * Age all trail points, prune expired ones, and upload the updated data
     * to the GPU texture.
     * @param {number} delta  Frame time in seconds.
     */
    update(delta) {
        // Points survive for fadeTime * 4 seconds; at that age the shader
        // fade factor exp(-4) ≈ 0.018 makes them visually negligible.
        const expiry = this.params.fadeTime * 4;

        for (let i = this.trail.length - 1; i >= 0; i--) {
            this.trail[i].age += delta;
            if (this.trail[i].age > expiry) {
                this.trail.splice(i, 1);
            }
        }

        // Handle inactivity and random point placement
        this.timeSinceLastMove += delta;

        // Start placing random points after 3 seconds of inactivity
        if (this.timeSinceLastMove >= 3.0 && !this.isPlacingRandomPoints) {
            this.isPlacingRandomPoints = true;
            this.randomPointTimer = 0;
        }

        // Place random points every 1.5 seconds when in random mode
        if (this.isPlacingRandomPoints) {
            this.randomPointTimer += delta;
            if (this.randomPointTimer >= 1.5) {
                this.addRandomPoint();
                this.randomPointTimer = 0;
            }
        }

        // Upload the latest MAX_TRAIL live points to the texture
        const count = Math.min(this.trail.length, MAX_TRAIL);

        if (count > 0 || this._uniforms.uTrailCount.value > 0) {
            for (let i = 0; i < count; i++) {
                const ti = i * 4;
                this.trailData[ti] = this.trail[i].x;
                this.trailData[ti + 1] = this.trail[i].z;
                this.trailData[ti + 2] = this.trail[i].age;
                this.trailData[ti + 3] = this.trail[i].distDelta;
            }
            this.trailTexture.needsUpdate = true;
            this._uniforms.uTrailCount.value = count;
        }
    }

    dispose() {
        this.canvas.removeEventListener("pointermove", this.onPointerMove);
        this.trailTexture.dispose();
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    bindPointerEvents() {
        this.onPointerMove = (e) => {
            this.mouseCoords.set(
                ((e.clientX - this.rect.left) / this.rect.width) * 2 - 1,
                -((e.clientY - this.rect.top) / this.rect.height) * 2 + 1,
            );

            this.raycaster.setFromCamera(this.mouseCoords, this.camera);
            const hits = this.raycaster.intersectObject(this.rayPlane);
            if (hits.length === 0) return;

            const { x, z } = hits[0].point;

            let distDelta = 0;
            // Only append a new point when the mouse has moved far enough
            if (this.lastPoint) {
                const dx = x - this.lastPoint.x;
                const dz = z - this.lastPoint.z;
                distDelta = Math.sqrt(dx * dx + dz * dz);
                if (distDelta < this.params.trailSpacing) return;
            }

            // Evict the oldest point if we're at capacity
            if (this.trail.length >= MAX_TRAIL) {
                this.trail.shift();
            }

            this.trail.push({ x, z, age: 0, distDelta });
            this.lastPoint = { x, z };

            // Reset timers when mouse moves
            this.timeSinceLastMove = 0;
            this.isPlacingRandomPoints = false;
            this.randomPointTimer = 0;
        };

        this.canvas.addEventListener("pointermove", this.onPointerMove);
    }

    addRandomPoint() {
        const x = (Math.random() * 0.5 - 0.25) * this.bounds;
        const z = (Math.random() * 0.5 - 0.25) * this.bounds;
        const distDelta = this.randomPointStrength + Math.random() * 0.2;

        if (this.trail.length >= MAX_TRAIL) {
            this.trail.shift();
        }

        this.trail.push({ x, z, age: 0, distDelta });
    }
}
