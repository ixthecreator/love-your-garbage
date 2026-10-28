import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { unzipSync } from 'fflate';

const INPUT_LIMIT = 100 * 1024 * 1024;
const EXPANDED_LIMIT = 250 * 1024 * 1024;
const FILE_LIMIT = 1600;
const MAX_TRIANGLES = 3000000;
const PAPER = '#eeece2';
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const extensions = /\.(gltf|glb|bin|png|jpe?g|webp|avif|ktx2)$/i;
const modelExtensions = /\.(gltf|glb)$/i;
const nextPaint = () => new Promise(resolve => setTimeout(resolve, 0));

function safePath(value, base = '') {
  let path;
  try { path = decodeURIComponent(String(value)); }
  catch { throw new Error('An asset filename contains invalid URL encoding.'); }
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(path)) {
    throw new Error('This scan references an external asset. Include all textures and buffers in the upload; remote URLs are not loaded.');
  }
  if (/[\x00-\x1f]/.test(path)) throw new Error('An asset filename contains unsupported characters.');
  const parts = (base + path.replace(/\\/g, '/')).split('/');
  const clean = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!clean.length) throw new Error('An asset path points outside the uploaded scan folder.');
      clean.pop();
    } else clean.push(part);
  }
  return clean.join('/');
}

function mimeFor(path) {
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  if (/\.webp$/i.test(path)) return 'image/webp';
  if (/\.avif$/i.test(path)) return 'image/avif';
  if (/\.gltf$/i.test(path)) return 'model/gltf+json';
  if (/\.glb$/i.test(path)) return 'model/gltf-binary';
  return 'application/octet-stream';
}

function parseDocument(bytes, name) {
  try {
    if (/\.glb$/i.test(name)) {
      if (bytes.byteLength < 20) throw new Error('Incomplete GLB header.');
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) throw new Error('A glTF 2.0 GLB file is required.');
      if (view.getUint32(8, true) !== bytes.byteLength) throw new Error('The GLB file is incomplete or has an invalid length.');
      const length = view.getUint32(12, true);
      if (view.getUint32(16, true) !== 0x4e4f534a || length > bytes.byteLength - 20) throw new Error('The GLB JSON chunk is missing or incomplete.');
      return JSON.parse(textDecoder.decode(bytes.subarray(20, 20 + length)).replace(/\x00+$/g, '').trim());
    }
    return JSON.parse(textDecoder.decode(bytes));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) throw new Error('This model contains invalid glTF data. Export a new GLB or glTF 2.0 file.');
    throw error;
  }
}

async function collectFiles(input, status) {
  const files = Array.from(input || []);
  if (!files.length) throw new Error('Choose a GLB, glTF or ZIP scan first.');
  if (files.length > FILE_LIMIT) throw new Error('This scan contains too many files. Use a single GLB or a smaller scan.');
  if (files.reduce((sum, file) => sum + file.size, 0) > INPUT_LIMIT) throw new Error('Choose a scan smaller than 100 MB in total.');
  const entries = new Map();
  let expanded = 0;
  let expandedCount = 0;
  const addEntry = (name, bytes) => {
    const path = safePath(name);
    if (!path || path.split('/').some(part => part.startsWith('.') || part === '__MACOSX')) return;
    expanded += bytes.byteLength;
    expandedCount++;
    if (expanded > EXPANDED_LIMIT || expandedCount > FILE_LIMIT) throw new Error('The expanded scan exceeds 250 MB or contains too many files.');
    if (!extensions.test(path)) return;
    if (entries.has(path)) throw new Error('Two uploaded files have the same name: ' + path + '. Use a ZIP that preserves their folders.');
    entries.set(path, bytes);
  };
  for (const file of files) {
    const name = file.webkitRelativePath || file.name;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.zip$/i.test(name)) {
      status('Unpacking your scan locally…');
      await nextPaint();
      let declaredTotal = expanded;
      let declaredCount = expandedCount;
      let unpacked;
      try {
        unpacked = unzipSync(bytes, {
          filter(entry) {
            declaredTotal += entry.originalSize;
            declaredCount++;
            if (declaredTotal > EXPANDED_LIMIT || declaredCount > FILE_LIMIT) throw new Error('The expanded ZIP exceeds 250 MB or contains too many files.');
            const path = safePath(entry.name);
            return !path.endsWith('/') && extensions.test(path) && !path.split('/').some(part => part.startsWith('.') || part === '__MACOSX');
          }
        });
      } catch (error) {
        if (error.message.includes('250 MB') || error.message.includes('asset') || error.message.includes('filename')) throw error;
        throw new Error('This ZIP could not be opened. Use an unencrypted ZIP containing one GLB or glTF scan and its assets.');
      }
      for (const [entryName, entryBytes] of Object.entries(unpacked)) addEntry(entryName, entryBytes);
    } else addEntry(name, bytes);
  }
  const models = [...entries.keys()].filter(name => modelExtensions.test(name));
  if (!models.length) throw new Error('No GLB or glTF model was found. Export your scan as GLB or glTF 2.0, then upload it with its textures.');
  if (models.length > 1) throw new Error('This upload contains more than one model. Choose the files for one tabletop scan, or a ZIP with one model.');
  return { entries, name: models[0] };
}

function resourceResolver(entries, name) {
  const base = name.includes('/') ? name.slice(0, name.lastIndexOf('/') + 1) : '';
  const resolve = uri => {
    const relative = safePath(uri, base);
    if (entries.has(relative)) return relative;
    const withoutBase = safePath(uri);
    if (entries.has(withoutBase)) return withoutBase;
    const filename = withoutBase.split('/').pop();
    const matches = [...entries.keys()].filter(path => path.split('/').pop() === filename);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error('Several assets share the name “' + filename + '”. Upload a ZIP with the original folder structure.');
    throw new Error('Missing local asset: ' + uri + '. Select the model, its .bin file and all textures together, or upload their ZIP.');
  };
  return resolve;
}

function checkDocument(json, resolve) {
  if (!json?.asset?.version || Number.parseInt(json.asset.version, 10) !== 2) throw new Error('This viewer supports glTF 2.0. Export your scan as GLB or glTF 2.0.');
  const used = new Set([...(json.extensionsRequired || []), ...(json.extensionsUsed || [])]);
  if (used.has('KHR_draco_mesh_compression')) throw new Error('This scan uses Draco compression. Re-export it as an uncompressed or Meshopt GLB/glTF; Draco is not available in this offline viewer.');
  if (used.has('KHR_texture_basisu')) throw new Error('This scan uses KTX2/Basis textures. Re-export it with JPEG or PNG textures for this offline viewer.');
  const resources = [...(json.buffers || []), ...(json.images || [])];
  for (const resource of resources) {
    if (typeof resource.uri !== 'string') continue;
    if (/^data:/i.test(resource.uri)) {
      if (!/^data:(?:image\/(?:png|jpe?g|webp|avif)|application\/(?:octet-stream|gltf-buffer));base64,/i.test(resource.uri)) {
        throw new Error('The scan contains an unsupported embedded asset. Use PNG/JPEG textures and binary buffers.');
      }
    } else {
      const local = resolve(resource.uri);
      if (/\.ktx2$/i.test(local)) throw new Error('KTX2 textures require an external decoder. Re-export your scan with PNG or JPEG textures.');
    }
  }
}

function disposeObject(root) {
  if (!root) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const texture of textures) {
    const image = texture.source?.data;
    if (image && typeof image.close === 'function') image.close();
    texture.dispose();
  }
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

async function parseLocalModel(input, status) {
  const { entries, name } = await collectFiles(input, status);
  const bytes = entries.get(name);
  const json = parseDocument(bytes, name);
  const resolve = resourceResolver(entries, name);
  checkDocument(json, resolve);
  status('Building your textured tabletop…');
  await nextPaint();
  const urls = new Map();
  const manager = new THREE.LoadingManager();
  const failedAssets = [];
  manager.onError = url => {
    const localName = [...urls].find(([, localURL]) => localURL === url)?.[0];
    failedAssets.push(localName || 'an embedded texture or buffer');
  };
  manager.setURLModifier(url => {
    if (/^(?:data:|blob:)/i.test(url)) return url;
    const path = resolve(url);
    if (!urls.has(path)) urls.set(path, URL.createObjectURL(new Blob([entries.get(path)], { type: mimeFor(path) })));
    return urls.get(path);
  });
  const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
  let root;
  try {
    const data = /\.glb$/i.test(name) ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : textDecoder.decode(bytes);
    const result = await loader.parseAsync(data, '');
    root = result.scene;
    if (failedAssets.length) throw new Error('Could not read ' + failedAssets[0] + '. Re-export the scan with valid PNG/JPEG textures and all binary buffers.');
    if (!root) throw new Error('This scan has no visible scene. Export the mesh with its scene enabled.');
    let triangles = 0;
    let meshes = 0;
    root.traverse(object => {
      if (!object.isMesh || !object.geometry?.attributes?.position) return;
      meshes++;
      triangles += (object.geometry.index?.count || object.geometry.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : 1);
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = true;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material?.isMeshBasicMaterial && material.map) material.toneMapped = false;
      }
    });
    if (!meshes || !triangles) throw new Error('No triangle mesh was found in this scan. Export a mesh rather than a point cloud.');
    if (triangles > MAX_TRIANGLES) throw new Error('This scan has more than 3 million triangles. Simplify the mesh before uploading it.');
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());
    if (bounds.isEmpty() || ![...size, ...bounds.min, ...bounds.max].every(Number.isFinite) || size.length() < 0.000001) throw new Error('The scan has invalid or empty dimensions. Export a valid mesh and try again.');
    return { root, name: name.split('/').pop(), triangles: Math.round(triangles), bounds };
  } catch (error) {
    if (root) disposeObject(root);
    const message = String(error?.message || '');
    if (/Missing local asset|asset|textures|triangles|dimensions|triangle mesh|visible scene|Draco|KTX2|glTF|multiple|file|scan|offline/i.test(message)) throw error;
    throw new Error('This scan could not be decoded. Check that the model and all textures were exported together as GLB or glTF 2.0.');
  } finally {
    for (const url of urls.values()) URL.revokeObjectURL(url);
  }
}

function makePlaceholder() {
  const root = new THREE.Group();
  const topMaterial = new THREE.MeshStandardMaterial({ color: '#eee9d8', roughness: 0.94 });
  const legMaterial = new THREE.MeshStandardMaterial({ color: '#656b54', roughness: 0.8, metalness: 0.12 });
  const tabletop = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.13, 3.65), topMaterial);
  tabletop.position.y = 1.47;
  tabletop.castShadow = true;
  tabletop.receiveShadow = true;
  root.add(tabletop);
  const edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(tabletop.geometry), new THREE.LineBasicMaterial({ color: '#777b63', transparent: true, opacity: 0.32 }));
  edgeLines.position.copy(tabletop.position);
  root.add(edgeLines);
  for (const x of [-2.75, 2.75]) for (const z of [-1.38, 1.38]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 1.4, 12), legMaterial);
    leg.position.set(x, 0.7, z);
    leg.castShadow = true;
    root.add(leg);
  }
  // One continuous tabletop: the complete three-day collection is a single scan.
  return root;
}

function validView(view) {
  return view && ['position', 'target'].every(key => Array.isArray(view[key]) && view[key].length === 3 && view[key].every(value => Number.isFinite(value) && Math.abs(value) < 10000));
}

function create({ canvas, onStatus = () => {} } = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') throw new Error('A canvas element is required for the 3D viewer.');
  const status = message => { try { onStatus(message); } catch { /* Keep viewer usable if a status listener fails. */ } };
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  } catch {
    throw new Error('3D viewing is unavailable in this browser. Enable WebGL or open this page in a current browser with hardware acceleration.');
  }
  renderer.setClearColor(PAPER, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.13;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAPER);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 300);
  camera.position.set(7, 6.3, 8.6);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.9, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.rotateSpeed = 0.65;
  controls.zoomSpeed = 0.75;
  controls.panSpeed = 0.75;
  controls.minDistance = 0.25;
  controls.maxDistance = 70;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.55;
  controls.maxPolarAngle = Math.PI * 0.93;
  controls.listenToKeyEvents(canvas);
  canvas.tabIndex = canvas.tabIndex < 0 ? 0 : canvas.tabIndex;
  if (!canvas.getAttribute('aria-label')) canvas.setAttribute('aria-label', 'Interactive 3D tabletop. Drag to orbit, scroll to zoom, right-drag to pan. Keyboard: arrows to pan, Shift and arrows to orbit, plus or minus to zoom, Home to reset, T for top view.');
  canvas.style.touchAction = 'none';
  const hemisphere = new THREE.HemisphereLight('#fffdf3', '#c1c3ae', 2.05);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight('#fffaf0', 2.4);
  sun.position.set(4.5, 10, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -9;
  sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 9;
  sun.shadow.camera.bottom = -9;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = 35;
  sun.shadow.normalBias = 0.025;
  sun.shadow.bias = -0.0001;
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#dfe9ec', 1.0);
  fill.position.set(-5, 4, -6);
  scene.add(fill);
  let environmentTarget;
  try {
    const room = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(renderer);
    environmentTarget = generator.fromScene(room, 0.06);
    scene.environment = environmentTarget.texture;
    scene.environmentIntensity = 0.45;
    room.dispose();
    generator.dispose();
  } catch { /* The balanced direct lights also support older GPUs. */ }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: '#333d26', opacity: 0.13 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.005;
  floor.receiveShadow = true;
  scene.add(floor);
  const placeholder = makePlaceholder();
  scene.add(placeholder);

  let model = null;
  let disposed = false;
  let dirty = true;
  let raf = 0;
  let lastTime = 0;
  let loadSequence = 0;
  let contextLost = false;
  let activeBounds = new THREE.Box3().setFromObject(placeholder);
  let defaultView;
  const markDirty = () => { dirty = true; };
  controls.addEventListener('change', markDirty);

  function captureView() {
    return { position: camera.position.toArray(), target: controls.target.toArray() };
  }

  function restoreView(view) {
    if (disposed || !validView(view)) return false;
    const position = new THREE.Vector3().fromArray(view.position);
    const target = new THREE.Vector3().fromArray(view.target);
    if (position.distanceTo(target) < 0.01) return false;
    controls.enableDamping = false;
    controls.update();
    camera.position.copy(position);
    controls.target.copy(target);
    camera.lookAt(target);
    controls.update();
    controls.enableDamping = true;
    markDirty();
    return true;
  }

  function framedView(direction, fitTarget = model || placeholder) {
    const center = activeBounds.getCenter(new THREE.Vector3());
    // Fit the rendered vertices into 90% of the viewing frustum. Empty corners
    // of an axis-aligned box must not make a long, shallow tabletop look small.
    const tanVertical = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * 0.90;
    const tanHorizontal = tanVertical * camera.aspect;
    const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const vertex = new THREE.Vector3();
    const instanceMatrix = new THREE.Matrix4();
    const worldMatrix = new THREE.Matrix4();
    let maxX = -Infinity, minX = Infinity, maxY = -Infinity, minY = Infinity;
    let maxDepth = -Infinity, count = 0;
    const include = point => {
      point.sub(center);
      const x = point.dot(right), y = point.dot(up), depth = point.dot(direction);
      maxX = Math.max(maxX, x + tanHorizontal * depth);
      minX = Math.min(minX, x - tanHorizontal * depth);
      maxY = Math.max(maxY, y + tanVertical * depth);
      minY = Math.min(minY, y - tanVertical * depth);
      maxDepth = Math.max(maxDepth, depth);
      count++;
    };
    fitTarget?.updateWorldMatrix(true, true);
    fitTarget?.traverseVisible(object => {
      const geometry = object.geometry;
      const position = geometry?.attributes?.position;
      if (!object.isMesh || !position) return;
      const index = geometry.index;
      const start = Math.max(0, geometry.drawRange.start);
      const end = Math.min(index?.count ?? position.count, start + geometry.drawRange.count);
      const instances = object.isInstancedMesh ? object.count : 1;
      for (let instance = 0; instance < instances; instance++) {
        if (object.isInstancedMesh) {
          object.getMatrixAt(instance, instanceMatrix);
          worldMatrix.multiplyMatrices(object.matrixWorld, instanceMatrix);
        } else worldMatrix.copy(object.matrixWorld);
        const seen = index ? new Uint8Array(position.count) : null;
        for (let item = start; item < end; item++) {
          const vertexIndex = index ? index.getX(item) : item;
          if (seen?.[vertexIndex]) continue;
          if (seen) seen[vertexIndex] = 1;
          object.getVertexPosition(vertexIndex, vertex);
          include(vertex.applyMatrix4(worldMatrix));
        }
      }
    });
    if (!count) {
      for (const x of [activeBounds.min.x, activeBounds.max.x]) {
        for (const y of [activeBounds.min.y, activeBounds.max.y]) {
          for (const z of [activeBounds.min.z, activeBounds.max.z]) include(vertex.set(x, y, z));
        }
      }
    }
    // These intervals solve for both distance and screen-centred target in
    // perspective, preserving every vertex rather than a guessed bounding sphere.
    const distance = Math.max(controls.minDistance, maxDepth + camera.near * 2, (maxX - minX) / (2 * tanHorizontal), (maxY - minY) / (2 * tanVertical));
    const target = center.clone().addScaledVector(right, (maxX + minX) / 2).addScaledVector(up, (maxY + minY) / 2);
    return { position: target.clone().addScaledVector(direction, distance).toArray(), target: target.toArray() };
  }

  function fitView(fitTarget = model || placeholder) {
    defaultView = framedView(new THREE.Vector3(1.0, 1.45, 1.18).normalize(), fitTarget);
    restoreView(defaultView);
  }

  function resetView() {
    if (defaultView) restoreView(defaultView);
  }

  function topView() {
    restoreView(framedView(new THREE.Vector3(0, 1, 0.0001).normalize()));
  }

  function focusDay() {
    // Compatibility for saved projects; there are no artificial day partitions.
    resetView();
    status(model ? 'The complete tabletop — three days together.' : 'Awaiting your complete tabletop scan.');
  }

  function rotateQuarter() {
    const offset = camera.position.clone().sub(controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    restoreView({ position: controls.target.clone().add(offset).toArray(), target: controls.target.toArray() });
  }

  function resize() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    markDirty();
  }

  function tick(time) {
    raf = 0;
    if (disposed || document.hidden || contextLost) return;
    const delta = Math.min((time - lastTime) / 1000 || 0.016, 0.1);
    lastTime = time;
    controls.update(delta);
    if (dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }
    raf = requestAnimationFrame(tick);
  }

  function visibility() {
    cancelAnimationFrame(raf);
    raf = 0;
    lastTime = 0;
    if (!document.hidden && !disposed && !contextLost) { markDirty(); raf = requestAnimationFrame(tick); }
  }

  function keydown(event) {
    if (disposed) return;
    if (['+', '=', '-', '_'].includes(event.key)) {
      event.preventDefault();
      const factor = ['+', '='].includes(event.key) ? 0.86 : 1.16;
      const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor);
      offset.clampLength(controls.minDistance, controls.maxDistance);
      restoreView({ position: controls.target.clone().add(offset).toArray(), target: controls.target.toArray() });
    } else if (event.key === 'Home') { event.preventDefault(); resetView(); }
    else if (event.key.toLowerCase() === 't') { event.preventDefault(); topView(); }
    else if (event.key.toLowerCase() === 'q') { event.preventDefault(); rotateQuarter(); }
  }

  function lost(event) {
    event.preventDefault();
    contextLost = true;
    cancelAnimationFrame(raf);
    raf = 0;
    status('The 3D graphics context was interrupted. Wait a moment, or reload the page if it does not return.');
  }

  function restored() {
    contextLost = false;
    markDirty();
    visibility();
    status(model ? 'Your scan is ready to explore.' : 'Awaiting your scan.');
  }

  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  observer?.observe(canvas);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', visibility);
  canvas.addEventListener('keydown', keydown);
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  resize();
  fitView();
  visibility();
  status('Awaiting your scan. Drag to orbit, scroll to zoom.');

  return {
    get hasModel() { return !!model; },
    async loadFiles(files) {
      if (disposed) throw new Error('This viewer has been closed. Reload the page to upload a scan.');
      const sequence = ++loadSequence;
      status('Reading your scan locally…');
      let parsed;
      let candidate;
      const previousModel = model;
      const previousBounds = activeBounds;
      const previousDefaultView = defaultView;
      const previousView = captureView();
      try {
        parsed = await parseLocalModel(files, message => { if (sequence === loadSequence && !disposed) status(message); });
        if (disposed || sequence !== loadSequence) {
          disposeObject(parsed.root);
          throw new Error('A newer scan upload replaced this request.');
        }
        candidate = new THREE.Group();
        candidate.add(parsed.root);
        candidate.traverse(object => {
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (material?.map) material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          }
        });
        const size = parsed.bounds.getSize(new THREE.Vector3());
        const center = parsed.bounds.getCenter(new THREE.Vector3());
        const scale = 6.2 / Math.max(size.x, size.y, size.z);
        candidate.scale.setScalar(scale);
        candidate.position.set(-center.x * scale, 0.02 - parsed.bounds.min.y * scale, -center.z * scale);
        candidate.updateMatrixWorld(true);
        const candidateBounds = new THREE.Box3().setFromObject(candidate);
        // Prepare completely before replacing the currently displayed scan.
        scene.add(candidate);
        if (previousModel) previousModel.visible = false;
        placeholder.visible = false;
        activeBounds = candidateBounds;
        fitView(candidate);
        renderer.render(scene, camera);
        if (previousModel) { scene.remove(previousModel); disposeObject(previousModel); }
        model = candidate;
        markDirty();
        status(parsed.name + ' · ' + parsed.triangles.toLocaleString() + ' triangles · ready to explore');
        return { name: parsed.name, triangles: parsed.triangles };
      } catch (error) {
        if (candidate && candidate !== model) { scene.remove(candidate); disposeObject(candidate); }
        if (!disposed && sequence === loadSequence && model === previousModel) {
          if (previousModel) previousModel.visible = true;
          placeholder.visible = !previousModel;
          activeBounds = previousBounds;
          defaultView = previousDefaultView;
          restoreView(previousView);
        }
        if (!disposed && sequence === loadSequence) status(error?.message || 'The scan could not be opened.');
        throw error;
      }
    },
    captureView,
    restoreView,
    resetView,
    topView,
    focusDay,
    setAutoRotate(value) { controls.autoRotate = Boolean(value); markDirty(); },
    rotateQuarter,
    snapshot() {
      if (disposed || contextLost) throw new Error('The 3D view is not ready for a snapshot.');
      renderer.render(scene, camera);
      return canvas.toDataURL('image/png');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      loadSequence++;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('keydown', keydown);
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
      controls.removeEventListener('change', markDirty);
      controls.dispose();
      disposeObject(model);
      disposeObject(placeholder);
      disposeObject(floor);
      environmentTarget?.dispose();
      sun.shadow.map?.dispose();
      renderer.dispose();
    }
  };
}

window.TabletopViewer = Object.freeze({ create });
