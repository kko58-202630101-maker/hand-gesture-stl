'use strict';

// ── GLOBAL VARIABLES & STATES ──
let scene, camera, renderer, stlMesh;
let hands, mpCamera;
let cameraActive = false;

// DOM Caching
const loadingEl      = document.getElementById('loading');
const statusBadge    = document.getElementById('status-badge');
const gestureDisplay = document.getElementById('current-gesture');
const fileInput      = document.getElementById('file-input');
const camBtn         = document.getElementById('cam-btn');
const resetBtn       = document.getElementById('reset-btn');
const webcamVideo    = document.getElementById('webcam-video');
const handCanvas     = document.getElementById('hand-canvas');
const handCtx        = handCanvas.getContext('2d');

const btnZoomIn   = document.getElementById('btn-zoom-in');
const btnZoomOut  = document.getElementById('btn-zoom-out');
const btnRotLeft  = document.getElementById('btn-rot-left');
const btnRotRight = document.getElementById('btn-rot-right');
const btnDemo     = document.getElementById('btn-demo');

// Motion Tracking State Container
const trackingFrame = { activeGesture: 'none', lastAnchorX: 0, lastAnchorY: 0 };

// ── 3D GRAPHICS ENGINE INITIALIZATION ──
function initThreeEngine() {
  const container = document.getElementById('viewer-container');
  const canvas    = document.getElementById('three-canvas');

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(0, 0, 6);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  // Lights Setup
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
  mainLight.position.set(4, 8, 5);
  scene.add(mainLight);

  // Resize Handler
  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  // Animation Frame Loop
  function renderTick() {
    requestAnimationFrame(renderTick);
    renderer.render(scene, camera);
  }
  renderTick();
}

// ── STL PARSER & SCENE LOADERS ──
function parseStlBinaryOrAscii(arrayBuffer) {
  const uint8View = new Uint8Array(arrayBuffer);
  const isAscii = () => new TextDecoder().decode(uint8View.slice(0, 128)).trim().startsWith('solid');
  const geometry = new THREE.BufferGeometry();
  const vertices = [], normals = [];

  if (isAscii()) {
    const lines = new TextDecoder().decode(uint8View).split('\n');
    let currNormal = [0, 0, 0];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('facet normal')) {
        const c = line.split(/\s+/); currNormal = [parseFloat(c[2]), parseFloat(c[3]), parseFloat(c[4])];
      } else if (line.startsWith('vertex')) {
        const c = line.split(/\s+/); vertices.push(parseFloat(c[1]), parseFloat(c[2]), parseFloat(c[3]));
        normals.push(...currNormal);
      }
    }
  } else {
    const dataView = new DataView(arrayBuffer);
    const total = dataView.getUint32(80, true);
    for (let i = 0; i < total; i++) {
      const offset = 84 + i * 50;
      const nx = dataView.getFloat32(offset, true), ny = dataView.getFloat32(offset+4, true), nz = dataView.getFloat32(offset+8, true);
      for (let v = 0; v < 3; v++) {
        const vOffset = offset + 12 + v * 12;
        vertices.push(dataView.getFloat32(vOffset, true), dataView.getFloat32(vOffset+4, true), dataView.getFloat32(vOffset+8, true));
        normals.push(nx, ny, nz);
      }
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

function renderStlToScene(buffer) {
  try {
    const geometry = parseStlBinaryOrAscii(buffer);
    if (stlMesh) { scene.remove(stlMesh); stlMesh.geometry.dispose(); stlMesh.material.dispose(); }
    
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const center = new THREE.Vector3(); box.getCenter(center);
    geometry.translate(-center.x, -center.y, -center.z);
    
    const size = new THREE.Vector3(); box.getSize(size);
    const scale = 3.5 / Math.max(size.x, size.y, size.z);

    stlMesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x4dabf7, metalness: 0.2, roughness: 0.3, side: THREE.DoubleSide }));
    stlMesh.scale.setScalar(scale);
    stlMesh.rotation.x = -Math.PI / 2;
    scene.add(stlMesh);
    
    resetCameraViewport();
    updateUiStatus('오브젝트 마운트 완결 ✅', 'ready');
  } catch (ex) { 
    updateUiStatus('파일 해석 실패 ❌', 'error'); 
  }
}

function resetCameraViewport() {
  camera.position.set(0, 0, 6);
  camera.lookAt(0, 0, 0);
  if (stlMesh) { stlMesh.position.set(0, 0, 0); stlMesh.rotation.set(-Math.PI / 2, 0, 0); }
  updateUiStatus('뷰포트 정렬 초기화 스캔', 'ready');
}

// ── GESTURE DETECTION KERNEL ──
function checkFingerState(landmarks, tip, dip) { return landmarks[tip].y < landmarks[dip].y; }

function processGestureParsing(landmarks) {
  const thumb  = landmarks[4].x < landmarks[3].x; 
  const index  = checkFingerState(landmarks, 8, 6);
  const middle = checkFingerState(landmarks, 12, 10);
  const ring   = checkFingerState(landmarks, 16, 14);
  const pinky  = checkFingerState(landmarks, 20, 18);

  const activeCount = [thumb, index, middle, ring, pinky].filter(Boolean).length;

  if (activeCount >= 4) return 'zoom_in';
  if (activeCount === 0) return 'zoom_out';
  if (index && middle && !ring && !pinky) return 'pan';
  if (index && !middle && !ring && !pinky) return 'rotate'; 

  return 'none';
}

// ── MEDIAPIPE MOTION TRACKING PIPELINE ──
function onCaptureResultHandler(results) {
  handCtx.save();
  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
  
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const singleHandPoints = results.multiHandLandmarks[0];
    
    drawConnectors(handCtx, singleHandPoints, HAND_CONNECTIONS, { color: '#4dabf7', lineWidth: 3 });
    drawLandmarks(handCtx, singleHandPoints, { color: '#ff922b', radius: 5 });

    const computedGesture = processGestureParsing(singleHandPoints);
    const uiLabels = {
      none: '안정화 대기 모드 (정지)',
      rotate: '☝️ 정밀 축 고정 회전 제어 중',
      pan: '✌️ 평면 초점 이동 중',
      zoom_in: '🖐️ 초점 전진 (Zoom In)',
      zoom_out: '✊ 초점 후퇴 (Zoom Out)'
    };
    gestureDisplay.textContent = uiLabels[computedGesture] || '추적 불능';

    if (stlMesh) {
      const currentX = singleHandPoints[9].x; 
      const currentY = singleHandPoints[9].y;

      switch (computedGesture) {
        case 'rotate':
          if (trackingFrame.activeGesture === 'rotate') {
            const deltaX = (currentX - trackingFrame.lastAnchorX) * 5.0;
            const deltaY = (currentY - trackingFrame.lastAnchorY) * 5.0;
            const absDeltaX = Math.abs(deltaX);
            const absDeltaY = Math.abs(deltaY);
            const deadzone = 0.006; 

            if (absDeltaX > absDeltaY && absDeltaX > deadzone) { stlMesh.rotation.y += deltaX; } 
            else if (absDeltaY > absDeltaX && absDeltaY > deadzone) { stlMesh.rotation.x += deltaY; }
          }
          break;
        case 'pan':
          if (trackingFrame.activeGesture === 'pan') {
            const deltaX = (currentX - trackingFrame.lastAnchorX) * 5.5;
            const deltaY = (currentY - trackingFrame.lastAnchorY) * -5.5;
            if (Math.abs(deltaX) > 0.005) stlMesh.position.x -= deltaX;
            if (Math.abs(deltaY) > 0.005) stlMesh.position.y -= deltaY;
          }
          break;
        case 'zoom_in':  
          // ⭐ 보자기를 펴면 축소가 아닌 확정이 되도록 '-'에서 '+'로 수정 완료
          camera.position.z = Math.max(1.5, camera.position.z - 0.08); 
          break; 
        case 'zoom_out': 
          // 주먹을 쥐면 멀어지도록 축소 로직 유지
          camera.position.z = Math.min(22.0, camera.position.z + 0.08); 
          break; 
      }

      trackingFrame.activeGesture = computedGesture;
      trackingFrame.lastAnchorX = currentX;
      trackingFrame.lastAnchorY = currentY;
    }
  } else {
    gestureDisplay.textContent = '손 감지 범위 이탈';
    trackingFrame.activeGesture = 'none';
  }
  handCtx.restore();
}

// ── CAMERA HARDWARE VISION LIFECYCLE ──
async function bootCameraVision() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } });
    webcamVideo.srcObject = stream; await webcamVideo.play();
    handCanvas.width = webcamVideo.videoWidth; handCanvas.height = webcamVideo.videoHeight;

    mpCamera = new Camera(webcamVideo, {
      onFrame: async () => { if (cameraActive) await hands.send({ image: webcamVideo }); }, width: 640, height: 480
    });
    mpCamera.start(); cameraActive = true; updateUiStatus('비전 엔진 정상 가동 개시', 'ready');
  } catch (err) { updateUiStatus('카메라 권한 에러 ❌', 'error'); }
}

function terminateCameraVision() {
  if (mpCamera) { mpCamera.stop(); mpCamera = null; }
  if (webcamVideo.srcObject) { webcamVideo.srcObject.getTracks().forEach(t => t.stop()); webcamVideo.srcObject = null; }
  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
  cameraActive = false; gestureDisplay.textContent = '카메라 셧다운'; updateUiStatus('분석 카메라 정지 상태', '');
}

function updateUiStatus(msg, statusClass = '') { statusBadge.textContent = msg; statusBadge.className = statusClass; }

// ── EVENT BINDINGS ──
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file || !file.name.toLowerCase().endsWith('.stl')) return;
  const reader = new FileReader(); reader.onload = (evt) => renderStlToScene(evt.target.result); reader.readAsArrayBuffer(file);
});

btnZoomIn.addEventListener('click', () => { camera.position.z = Math.max(1, camera.position.z - 0.5); });
btnZoomOut.addEventListener('click', () => { camera.position.z = Math.min(25, camera.position.z + 0.5); });
btnRotLeft.addEventListener('click', () => { if (stlMesh) stlMesh.rotation.z -= 0.2; });
btnRotRight.addEventListener('click', () => { if (stlMesh) stlMesh.rotation.z += 0.2; });
btnDemo.addEventListener('click', () => {
  if (stlMesh) scene.remove(stlMesh);
  stlMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: 0xff922b }));
  scene.add(stlMesh); resetCameraViewport(); updateUiStatus('샘플 프리셋 로드 완료', 'ready');
});

camBtn.addEventListener('click', () => { if (cameraActive) terminateCameraVision(); else bootCameraVision(); });
resetBtn.addEventListener('click', resetCameraViewport);

// ── INITIAL LOAD ENTRY POINT ──
window.addEventListener('load', () => {
  initThreeEngine();
  hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
  hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.6 });
  hands.onResults(onCaptureResultHandler);
  loadingEl.classList.add('hidden');
});
