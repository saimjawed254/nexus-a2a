import * as THREE from "three";
import Orchestrator from "./Orchestrator.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { VignetteRGBShiftShader } from "./Effects/VignetteRGBShiftShader.js";

export default class Renderer {
    constructor() {
        this.orchestrator = new Orchestrator();
        this.canvas = this.orchestrator.canvas;
        this.sizes = this.orchestrator.sizes;
        this.scene = this.orchestrator.scene;
        this.camera = this.orchestrator.camera;

        this.setInstance();
        this.setPostProcessing();
        this.setGUI();
    }

    setInstance() {
        this.instance = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
        });
        this.instance.toneMapping = THREE.ACESFilmicToneMapping;
        this.instance.toneMappingExposure = 1.95;
        this.instance.shadowMap.enabled = true;
        this.instance.shadowMap.type = THREE.PCFShadowMap;
        this.instance.setClearColor("#808080");
        this.instance.setSize(this.sizes.width, this.sizes.height);
        this.instance.setPixelRatio(this.sizes.pixelRatio);
    }

    setPostProcessing() {
        this.composer = new EffectComposer(this.instance);
        this.renderPass = new RenderPass(this.scene, this.camera.instance);
        this.composer.addPass(this.renderPass);

        this.vignetteRGBShiftPass = new ShaderPass(VignetteRGBShiftShader);
        this.vignetteRGBShiftPass.uniforms.shiftAmount.value = 0.005; // Adjust the intensity of the RGB shift
        this.vignetteRGBShiftPass.uniforms.vignetteRadius.value = 0.3; // Adjust where the effect starts (0.0 to 1.0)
        this.vignetteRGBShiftPass.uniforms.vignetteSoftness.value = 0.3; // Adjust the falloff smoothness of the effect
        this.composer.addPass(this.vignetteRGBShiftPass);

        this.outputPass = new OutputPass();
        this.composer.addPass(this.outputPass);
    }

    setGUI() {
        this.gui = this.orchestrator.debug.ui;
        if (!this.gui) return;
        const ppFolder = this.gui.addFolder("Post Processing");

        ppFolder
            .add(
                this.vignetteRGBShiftPass.uniforms.shiftAmount,
                "value",
                0,
                0.02,
                0.001,
            )
            .name("Shift Amount");
        ppFolder
            .add(
                this.vignetteRGBShiftPass.uniforms.vignetteRadius,
                "value",
                0,
                1,
                0.01,
            )
            .name("Vignette Radius");
        ppFolder
            .add(
                this.vignetteRGBShiftPass.uniforms.vignetteSoftness,
                "value",
                0,
                1,
                0.01,
            )
            .name("Vignette Softness");
    }

    resize() {
        this.instance.setSize(this.sizes.width, this.sizes.height);
        this.instance.setPixelRatio(this.sizes.pixelRatio);
        this.composer.setSize(this.sizes.width, this.sizes.height);
        this.composer.setPixelRatio(this.sizes.pixelRatio);
    }

    update() {
        // render via composer when you have post-processing effects, otherwise use the renderer directly
        this.composer.render();
        // this.instance.render(this.scene, this.camera.instance);
    }
}
