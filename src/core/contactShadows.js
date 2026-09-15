import * as THREE from 'three';

/**
 * Contact shadows — the soft dark pool directly beneath an object.
 *
 * This is not a shadow map. We render the scene's depth from *below* the
 * ground plane into a texture, fade it by distance, blur it twice, and lay it
 * on a transparent plane. The result is view-independent, has no shadow-acne,
 * costs almost nothing, and — crucially — writes into the alpha channel, so a
 * transparent PNG carries a real grounding shadow that composites over any
 * background colour in Photoshop or After Effects.
 *
 * Almost every "floating object" problem in a product render is fixed by this.
 */

const BLUR_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const makeBlur = (axis) => /* glsl */`
uniform sampler2D tDiffuse;
uniform float h;
varying vec2 vUv;
void main() {
  vec4 sum = vec4(0.0);
  ${axis === 'x' ? `
  sum += texture2D(tDiffuse, vec2(vUv.x - 4.0 * h, vUv.y)) * 0.051;
  sum += texture2D(tDiffuse, vec2(vUv.x - 3.0 * h, vUv.y)) * 0.0918;
  sum += texture2D(tDiffuse, vec2(vUv.x - 2.0 * h, vUv.y)) * 0.12245;
  sum += texture2D(tDiffuse, vec2(vUv.x - 1.0 * h, vUv.y)) * 0.1531;
  sum += texture2D(tDiffuse, vec2(vUv.x,           vUv.y)) * 0.1633;
  sum += texture2D(tDiffuse, vec2(vUv.x + 1.0 * h, vUv.y)) * 0.1531;
  sum += texture2D(tDiffuse, vec2(vUv.x + 2.0 * h, vUv.y)) * 0.12245;
  sum += texture2D(tDiffuse, vec2(vUv.x + 3.0 * h, vUv.y)) * 0.0918;
  sum += texture2D(tDiffuse, vec2(vUv.x + 4.0 * h, vUv.y)) * 0.051;` : `
  sum += texture2D(tDiffuse, vec2(vUv.x, vUv.y - 4.0 * h)) * 0.051;
  sum += texture2D(tDiffuse, vec2(vUv.x, vUv.y - 3.0 * h)) * 0.0918;
  sum += texture2D(tDiffuse, vec2(vUv.x, vUv.y - 2.0 * h)) * 0.12245;
  sum += texture2D(tDiffuse, vec2(vUv.x, vUv.y - 1.0 * h)) * 0.1531;
  sum += texture2D(tDiffuse, vec2(vUv.x, vUv.y          )) * 0.1633;
  sum += texture2D(tDiffuse, vec2(vUv.x, vUv.y + 1.0 * h)) * 0.1531;
  sum += texture2D(tDiffuse, vec2(vUv.x, vUv.y + 2.0 * h)) * 0.12245;
  sum += texture2D(tDiffuse, vec2(vUv.x, vUv.y + 3.0 * h)) * 0.0918;
  sum += texture2D(tDiffuse, vec2(vUv.x, vUv.y + 4.0 * h)) * 0.051;`}
  gl_FragColor = sum;
}`;

export class ContactShadows {
  /**
   * @param {object} opts
   * @param {number} opts.size       side length of the shadow plane, scene units
   * @param {number} opts.height     how far above the plane objects still cast
   * @param {number} opts.resolution render target size
   */
  constructor({ size = 4, height = 0.4, resolution = 512, darkness = 1.0, blur = 2.0, opacity = 1.0 } = {}) {
    this.size = size;
    this.height = height;
    this.blurAmount = blur;
    this.opacity = opacity;

    this.group = new THREE.Group();
    this.group.name = 'ContactShadows';
    this.group.renderOrder = 1;

    this.renderTarget = new THREE.WebGLRenderTarget(resolution, resolution, { format: THREE.RGBAFormat });
    this.renderTarget.texture.generateMipmaps = false;
    // The shadow camera looks upward, so its image is mirrored with respect to
    // the plane it is projected back onto. Flip V to line the two up.
    this.renderTarget.texture.wrapS = this.renderTarget.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.renderTarget.texture.repeat.set(1, -1);
    this.renderTarget.texture.offset.set(0, 1);
    this.renderTargetBlur = new THREE.WebGLRenderTarget(resolution, resolution, { format: THREE.RGBAFormat });
    this.renderTargetBlur.texture.generateMipmaps = false;

    // Rotate so the surface normal points UP. (rotateX(+90) would leave it
    // facing down, where front-face culling hides the shadow from any camera
    // above it — which is every camera that matters.)
    const planeGeo = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    this.planeGeo = planeGeo;

    this.plane = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({
      map: this.renderTarget.texture,
      opacity: this.opacity,
      transparent: true,
      depthWrite: false,
      // The depth pass writes black with alpha = occlusion, so the texture is
      // its own matte. DoubleSide keeps it visible from below as well, which
      // matters for reflective floors and under-camera angles.
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending
    }));
    this.plane.renderOrder = 1;
    this.plane.position.y = 0.0012;   // sit just above the floor to avoid z-fighting
    this.group.add(this.plane);

    // Camera looking straight up through the object.
    //
    // It is deliberately dropped a hair below the ground plane. An object that
    // has been grounded sits with its base at exactly y = 0, so a camera at
    // y = 0 with near = 0 puts that base precisely on the near plane, where it
    // is clipped — and the contact shadow, which is almost entirely made of
    // that base, silently disappears.
    this.epsilon = Math.max(1e-4, height * 0.02);
    this.shadowCamera = new THREE.OrthographicCamera(
      -size / 2, size / 2, size / 2, -size / 2, 0, height + this.epsilon
    );
    this.shadowCamera.position.y = -this.epsilon;
    this.shadowCamera.rotation.x = Math.PI / 2;
    this.group.add(this.shadowCamera);

    this.depthMaterial = new THREE.MeshDepthMaterial();
    this.depthMaterial.userData.darkness = { value: darkness };
    this.depthMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.darkness = this.depthMaterial.userData.darkness;
      shader.fragmentShader = /* glsl */`
        uniform float darkness;
        ${shader.fragmentShader.replace(
          'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
          'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );'
        )}`;
    };
    this.depthMaterial.depthTest = false;
    this.depthMaterial.depthWrite = false;
    // Looking up at an object means seeing the inside of its surfaces. With
    // front-face culling those are all discarded and the shadow comes out
    // empty, so the occlusion pass must consider both sides.
    this.depthMaterial.side = THREE.DoubleSide;

    this.blurPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.blurPlane.visible = false;
    this.group.add(this.blurPlane);

    this.hBlur = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, h: { value: 1 / 256 } },
      vertexShader: BLUR_VERT, fragmentShader: makeBlur('x'), depthTest: false
    });
    this.vBlur = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, h: { value: 1 / 256 } },
      vertexShader: BLUR_VERT, fragmentShader: makeBlur('y'), depthTest: false
    });

    this.blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  set darkness(v) { this.depthMaterial.userData.darkness.value = v; }
  get darkness() { return this.depthMaterial.userData.darkness.value; }

  configure({ size, height, darkness, blur, opacity } = {}) {
    if (size !== undefined && size !== this.size) {
      this.size = size;
      this.planeGeo.dispose();
      this.planeGeo = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
      this.plane.geometry = this.planeGeo;
      this.shadowCamera.left = -size / 2; this.shadowCamera.right = size / 2;
      this.shadowCamera.top = size / 2; this.shadowCamera.bottom = -size / 2;
      this.shadowCamera.updateProjectionMatrix();
    }
    if (height !== undefined) {
      this.height = height;
      this.epsilon = Math.max(1e-4, height * 0.02);
      this.shadowCamera.position.y = -this.epsilon;
      this.shadowCamera.far = height + this.epsilon;
      this.shadowCamera.updateProjectionMatrix();
    }
    if (darkness !== undefined) this.darkness = darkness;
    if (blur !== undefined) this.blurAmount = blur;
    if (opacity !== undefined) { this.opacity = opacity; this.plane.material.opacity = opacity; }
  }

  /** Re-render the shadow. Call whenever the object or its transform changes. */
  update(renderer, scene) {
    this.updateCount = (this.updateCount || 0) + 1;
    const prevBg = scene.background;
    const prevOverride = scene.overrideMaterial;
    const prevTarget = renderer.getRenderTarget();
    const prevClearAlpha = renderer.getClearAlpha();

    this.group.visible = false;
    scene.background = null;

    // Hide the set: the catcher plane, the cyclorama and the floor all sit at
    // or below y = 0, so an upward-looking depth pass sees them at point-blank
    // range and fills the entire shadow with solid occlusion. Only the subject
    // should cast a contact shadow.
    const hidden = [];
    scene.traverse((o) => {
      if (o.visible && o.userData && o.userData.excludeFromContactShadow) {
        hidden.push(o);
        o.visible = false;
      }
    });

    scene.overrideMaterial = this.depthMaterial;

    renderer.setRenderTarget(this.renderTarget);
    renderer.setClearAlpha(0);
    renderer.clear();
    renderer.render(scene, this.shadowCamera);

    scene.overrideMaterial = prevOverride;
    for (const o of hidden) o.visible = true;

    this._blur(renderer, this.blurAmount);
    this._blur(renderer, this.blurAmount * 0.4);   // second, tighter pass smooths banding

    renderer.setRenderTarget(prevTarget);
    renderer.setClearAlpha(prevClearAlpha);
    scene.background = prevBg;
    this.group.visible = true;
  }

  _blur(renderer, amount) {
    this.blurPlane.visible = true;

    this.blurPlane.material = this.hBlur;
    this.hBlur.uniforms.tDiffuse.value = this.renderTarget.texture;
    this.hBlur.uniforms.h.value = (amount * 1) / 256;
    renderer.setRenderTarget(this.renderTargetBlur);
    renderer.render(this.blurPlane, this.blurCamera);

    this.blurPlane.material = this.vBlur;
    this.vBlur.uniforms.tDiffuse.value = this.renderTargetBlur.texture;
    this.vBlur.uniforms.h.value = (amount * 1) / 256;
    renderer.setRenderTarget(this.renderTarget);
    renderer.render(this.blurPlane, this.blurCamera);

    this.blurPlane.visible = false;
  }

  dispose() {
    this.renderTarget.dispose();
    this.renderTargetBlur.dispose();
    this.planeGeo.dispose();
    this.plane.material.dispose();
    this.blurPlane.geometry.dispose();
    this.hBlur.dispose();
    this.vBlur.dispose();
    this.depthMaterial.dispose();
  }
}
