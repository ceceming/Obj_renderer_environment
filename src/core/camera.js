import * as THREE from 'three';
import { SENSORS } from './schema.js';
import { placeOnSphere } from './environment.js';

const DEG = Math.PI / 180;

/**
 * Camera control.
 *
 * Framing is expressed the way a photographer thinks about it — a focal length
 * on a named sensor, an angle around the subject, and "how much of the frame
 * should the subject fill" — rather than as an XYZ position. That makes a saved
 * look reusable across completely different models and output aspect ratios.
 */

/** Vertical FOV in degrees for a focal length on a given sensor. */
export function focalToFov(focalLength, sensorKey = 'full-frame') {
  const sensor = SENSORS[sensorKey] || SENSORS['full-frame'];
  return 2 * Math.atan(sensor.h / (2 * focalLength)) / DEG;
}

/** Inverse: what focal length gives this vertical FOV. */
export function fovToFocal(fovDeg, sensorKey = 'full-frame') {
  const sensor = SENSORS[sensorKey] || SENSORS['full-frame'];
  return sensor.h / (2 * Math.tan((fovDeg * DEG) / 2));
}

export function createCamera(cfg, aspect) {
  if (cfg.camera.projection === 'orthographic') {
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, cfg.camera.near, cfg.camera.far);
    cam.userData.isOrtho = true;
    return cam;
  }
  const cam = new THREE.PerspectiveCamera(
    focalToFov(cfg.camera.focalLength, cfg.camera.sensor),
    aspect,
    cfg.camera.near,
    cfg.camera.far
  );
  return cam;
}

/**
 * Position and aim the camera to frame `box`.
 * Returns the resolved distance so the UI can display it.
 */
export function applyCamera(camera, cfg, box, aspect) {
  const c = cfg.camera;
  const size = box.getSize(new THREE.Vector3());
  const boxCenter = box.getCenter(new THREE.Vector3());

  // Target: 'auto' uses the vertical centre of the bounds; manual lets you
  // aim at, say, the top third of a tall object.
  const target = new THREE.Vector3();
  if (c.targetMode === 'manual') {
    target.set(
      boxCenter.x + (c.target.x || 0) * size.x,
      box.min.y + (c.target.y ?? 0.5) * size.y,
      boxCenter.z + (c.target.z || 0) * size.z
    );
  } else {
    target.copy(boxCenter);
    if (c.target && typeof c.target.y === 'number' && c.target.y !== 0.5) {
      target.y = box.min.y + c.target.y * size.y;
    }
  }

  // Orientation vectors from the spherical angles.
  const dirFromSubject = placeOnSphere(new THREE.Vector3(), c.azimuth, c.elevation, 1).normalize();
  const viewDir = dirFromSubject.clone().negate();      // camera looks this way
  const worldUp = new THREE.Vector3(0, 1, 0);
  let right = new THREE.Vector3().crossVectors(viewDir, worldUp);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);       // straight up/down
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, viewDir).normalize();

  const framing = Math.max(0.05, c.framing ?? 0.85);
  let distance;

  if (c.projection === 'orthographic') {
    // Fit the projected extent of the 8 corners.
    let maxH = 0, maxV = 0;
    forEachCorner(box, (p) => {
      const d = p.clone().sub(target);
      maxH = Math.max(maxH, Math.abs(d.dot(right)));
      maxV = Math.max(maxV, Math.abs(d.dot(up)));
    });
    const halfV = Math.max(maxV, maxH / aspect) / framing;
    camera.left = -halfV * aspect; camera.right = halfV * aspect;
    camera.top = halfV; camera.bottom = -halfV;
    camera.zoom = c.orthoZoom ?? 1;
    const radius = size.length();
    distance = typeof c.distance === 'number' ? c.distance : radius * 2 + 1;
    camera.near = 0.001;
    camera.far = distance + radius * 4 + 10;
  } else {
    camera.fov = focalToFov(c.focalLength, c.sensor);
    camera.aspect = aspect;
    const halfV = Math.tan((camera.fov * DEG) / 2);
    const halfH = halfV * aspect;

    if (typeof c.distance === 'number' && Number.isFinite(c.distance)) {
      distance = c.distance;
    } else {
      // Exact fit: for every corner, solve the minimum distance that keeps it
      // inside both the horizontal and vertical frustum planes, then take the
      // largest. Tighter and more predictable than a bounding-sphere fit.
      let needed = 0;
      forEachCorner(box, (p) => {
        const d = p.clone().sub(target);
        const a = Math.abs(d.dot(right));
        const b = Math.abs(d.dot(up));
        const f = d.dot(viewDir);                 // +ve = further from camera
        needed = Math.max(needed, a / halfH - f, b / halfV - f);
      });
      distance = Math.max(needed / framing, size.length() * 0.05);
    }
    const radius = size.length();
    camera.near = Math.max(0.001, distance - radius * 1.5);
    camera.far = distance + radius * 6 + 20;
  }

  camera.position.copy(target).addScaledVector(dirFromSubject, distance);
  camera.up.copy(worldUp);
  camera.lookAt(target);

  // Dutch angle: roll around the view axis.
  if (c.roll) camera.rotateZ(c.roll * DEG);

  camera.updateProjectionMatrix();

  // Lens shift — move the frame without tilting the camera, so verticals stay
  // vertical. This is the digital equivalent of a tilt-shift lens and it is
  // what stops tall objects from keystoning.
  const sx = c.shift?.x || 0, sy = c.shift?.y || 0;
  if (sx || sy) {
    camera.projectionMatrix.elements[8] += sx * 2;
    camera.projectionMatrix.elements[9] += sy * 2;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }

  camera.userData.target = target;
  camera.userData.distance = distance;
  camera.updateMatrixWorld(true);
  return { distance, target };
}

function forEachCorner(box, fn) {
  const { min, max } = box;
  const v = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z);
    fn(v);
  }
}

/**
 * Resolve the focus distance for depth of field.
 * 'subject'  — focus on the aim point (what you almost always want)
 * 'nearest'  — focus on the closest surface, so the front edge is sharp
 * 'manual'   — an explicit distance in scene units
 */
export function resolveFocusDistance(camera, cfg, box) {
  const dof = cfg.camera.dof;
  if (dof.focusMode === 'manual') return dof.focusDistance;
  const target = camera.userData.target || box.getCenter(new THREE.Vector3());
  if (dof.focusMode === 'nearest') {
    let nearest = Infinity;
    forEachCorner(box, (p) => { nearest = Math.min(nearest, camera.position.distanceTo(p)); });
    return nearest;
  }
  return camera.position.distanceTo(target);
}

/**
 * Circle-of-confusion scale for a given aperture.
 * Physically: CoC grows with aperture diameter (focal / fStop), so low f-numbers
 * blur more. We expose it as a bokeh scale for the raster DOF pass; the path
 * tracer models the aperture directly instead.
 */
export function apertureToBokehScale(cfg) {
  const { focalLength, dof } = cfg.camera;
  const aperture = focalLength / Math.max(0.7, dof.fStop);   // entrance pupil, mm
  return (aperture / 50) * (dof.maxBlur ?? 0.012);
}

/** Interactive orbit: convert a drag into azimuth/elevation deltas. */
export function orbitDelta(cfg, dx, dy, speed = 0.35) {
  const azimuth = cfg.camera.azimuth - dx * speed;
  const elevation = Math.max(-89.5, Math.min(89.5, cfg.camera.elevation + dy * speed));
  return { azimuth: ((azimuth % 360) + 360) % 360 > 180 ? (azimuth % 360) - 360 : azimuth % 360, elevation };
}
