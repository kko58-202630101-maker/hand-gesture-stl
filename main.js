'use strict';

// ═══════════════════════════════════════════════
//  GLOBALS
// ═══════════════════════════════════════════════
let scene, camera, renderer, stlMesh;
let hands, mpCamera;
let cameraActive = false;

const loadingEl      = document.getElementById('loading');
const statusBadge    = document.getElementById('status-badge');
const gestureDisplay = document.getElementById('current-gesture');
const fileInput      = document.getElementById('file-input');
const camBtn         = document.getElementById('cam-btn');
const resetBtn       = document.getElementById('reset-btn');
const webcamVideo    = document.getElementById('webcam-video');
const handCanvas     = document.getElementById('hand-canvas');
const handCtx        = handCanvas.getContext('2d');

// 제스처 상태
const gesture = {
  type: 'none',       // none | rotate | pan | pinch | open
  prevX: 0,
  prevY: 0,
  prevPinchDist: 0,
};

// ═══════════════════════════════════════════════
//  THREE.JS 초기화
// ═══════════════════════════════════════════════
function initThree() {
  const container = document.getElementById('viewer-container');
  const canvas    = document.getElementById('three-canvas');

  // 씬
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  // 카메라
  camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.01,
    10000
  );
  camera.position.set(0, 0, 5);

  // 렌더러
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);

  // 조명
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(5, 10, 7);
  scene.add(dirLight);

  const backLight = new THREE.DirectionalLight(0x8888ff, 0.3);
  backLight.position.set(-5, -5, -5);
  scene.add(backLight);

  // 그리드 (파일 로드 전 안내용)
  const grid = new THREE.GridHelper(10, 20, 0x222222, 0x1a1a1a);
  grid.name = 'grid';
  scene.add(grid);

  // 리사이즈
  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  // 렌더 루프
  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();
}

// ═══════════════════════════════════════════════
//  STL 파서 (Three.js STLLoader 인라인 구현)
//  — CDN r128 에는 STLLoader 가 별도 파일이므로
//    직접 구현하여 외부 의존성 제거
// ═══════════════════════════════════════════════
function parseSTL(buffer) {
  // ASCII vs Binary 판별
  const uint8 = new Uint8Array(buffer);

  function isASCII(buf) {
    // 첫 256 바이트에 'solid' 키워드가 있고 제어문자 없으면 ASCII
    const header = new TextDecoder().decode(buf.slice(0, 256));
    return header.trimStart().startsWith('solid');
  }

  const geometry = new THREE.BufferGeometry();
  let positions = [];
  let normals   = [];

  if (isASCII(uint8)) {
    // ── ASCII STL ──
    const text = new TextDecoder().decode(uint8);
    const lines = text.split('\n');
    let normal = [0, 0, 0];

    for (const raw of lines) {
      const line = raw.trim();

      if (line.startsWith('facet normal')) {
        const parts = line.split(/\s+/);
        normal = [parseFloat(parts[2]), parseFloat(parts[3]), parseFloat(parts[4])];
      } else if (line.startsWith('vertex')) {
        const parts = line.split(/\s+/);
        positions.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
        normals.push(...normal);
      }
    }
  } else {
    // ── Binary STL ──
    const view       = new DataView(buffer);
    const triCount   = view.getUint32(80, true);

    for (let i = 0; i < triCount; i++) {
      const offset = 84 + i * 50;

      const nx = view.getFloat32(offset,      true);
      const ny = view.getFloat32(offset + 4,  true);
      const nz = view.getFloat32(offset + 8,  true);

      for (let v = 0; v < 3; v++) {
        const vOffset = offset + 12 + v * 12;
        positions.push(
          view.getFloat32(vOffset,      true),
          view.getFloat32(vOffset + 4,  true),
          view.getFloat32(vOffset + 8,  true)
        );
        normals.push(nx, ny, nz);
      }
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));
  geometry.computeBoundingBox();

  return geometry;
}

// ═══════════════════════════════════════════════
//  STL 로드 & 씬 배치
// ═══════════════════════════════════════════════
function loadSTL(buffer) {
  try {
    const geometry = parseSTL(buffer);

    // 기존 메시 제거
    if (stlMesh) {
      scene.remove(stlMesh);
      stlMesh.geometry.dispose();
      stlMesh.material.dispose();
    }

    // 그리드 숨기기
    const grid = scene.getObjectByName('grid');
    if (grid) grid.visible = false;

    // 중심 정렬 & 정규화
    geometry.computeBoundingBox();
    const box    = geometry.boundingBox;
    const center = new THREE.Vector3();
    box.getCenter(center);
    geometry.translate(-center.x, -center.y, -center.z);

    const size   = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale  = 3.0 / maxDim;

    // 메시 생성
    const material = new THREE.MeshPhongMaterial({
      color:     0x4499ff,
      specular:  0x222222,
      shininess: 60,
      side:      THREE.DoubleSide,
    });

    stlMesh = new THREE.Mesh(geometry, material);
    stlMesh.scale.setScalar(scale);
    stlMesh.rotation.x = -Math.PI / 2; // STL 기본 방향 보정
    scene.add(stlMesh);

    // 카메라 리셋
    resetView();

    setStatus('STL 로드 완료 ✅', 'ready');
  } catch (err) {
    console.error(err);
    setStatus('STL 파싱 오류 ❌', 'error');
  }
}

// ═══════════════════════════════════════════════
//  뷰 초기화
// ═══════════════════════════════════════════════
function resetView() {
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  if (stlMesh) {
    stlMesh.position.set(0, 0, 0);
    stlMesh.rotation.x = -Math.PI / 2;
    stlMesh.rotation.y = 0;
    stlMesh.rotation.z = 0;
  }
}

// ═══════════════════════════════════════════════
//  상태 표시
// ═══════════════════════════════════════════════
function setStatus(msg, type = '') {
  statusBadge.textContent = msg;
  statusBadge.className   = type ? `${type}` : '';
}

// ═══════════════════════════════════════════════
//  손 랜드마크 유틸
// ═══════════════════════════════════════════════

/** 두 랜드마크 사이의 2D 거리 */
function dist2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 손가락이 펴져 있으면 true
 * tip(끝) y 좌표가 pip(두 번째 마디) y 좌표보다 작으면 펴진 것
 * (MediaPipe 좌표계: y는 아래로 증가)
 */
function isFingerUp(lm, tipIdx, pipIdx) {
  return lm[tipIdx].y < lm[pipIdx].y;
}

/**
 * 제스처 분류
 *  - pinch  : 엄지(4) + 검지(8) 가까움
 *  - one    : 검지만 폄
 *  - two    : 검지 + 중지 폄
 *  - open   : 4개 이상 폄
 *  - none   : 기타
 */
function classifyGesture(lm) {
  const thumbUp  = lm[4].y  < lm[3].y;
  const indexUp  = isFingerUp(lm, 8,  6);
  const middleUp = isFingerUp(lm, 12, 10);
  const ringUp   = isFingerUp(lm, 16, 14);
  const pinkyUp  = isFingerUp(lm, 20, 18);

  const extCount = [thumbUp, indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;

  // 핀치: 엄지-검지 거리 < 0.07 (정규화 좌표)
  const pinchDist = dist2D(lm[4], lm[8]);
  if (pinchDist < 0.07) return 'pinch';

  if (extCount >= 4)                       return 'open';
  if (indexUp && middleUp && !ringUp)      return 'two';
  if (indexUp && !middleUp)                return 'one';

  return 'none';
}

// ═══════════════════════════════════════════════
//  MediaPipe Hands 초기화
// ═══════════════════════════════════════════════
function initMediaPipe() {
  hands = new Hands({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands:           1,
    modelComplexity:       1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence:  0.6,
  });

  hands.onResults(onHandResults);
}

// ═══════════════════════════════════════════════
//  웹캠 시작 / 중지
// ═══════════════════════════════════════════════
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
    });
    webcamVideo.srcObject = stream;
    await webcamVideo.play();

    handCanvas.width  = webcamVideo.videoWidth  || 640;
    handCanvas.height = webcamVideo.videoHeight || 480;

    mpCamera = new Camera(webcamVideo, {
      onFrame: async () => {
        await hands.send({ image: webcamVideo });
      },
      width:  640,
      height: 480,
    });
    mpCamera.start();

    cameraActive = true;
    setStatus('카메라 활성화 — 손을 보여주세요', 'ready');
  } catch (err) {
    console.error(err);
    setStatus('카메라 접근 권한 필요 ❌', 'error');
  }
}

function stopCamera() {
  if (mpCamera) { mpCamera.stop(); mpCamera = null; }
  if (webcamVideo.srcObject) {
    webcamVideo.srcObject.getTracks().forEach(t => t.stop());
    webcamVideo.srcObject = null;
  }
  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
  cameraActive = false;
  gestureDisplay.textContent = '카메라 꺼짐';
  setStatus('카메라 꺼짐', '');
}

// ═══════════════════════════════════════════════
//  손 인식 콜백 → 3D 제어
// ═══════════════════════════════════════════════
const GESTURE_LABELS = {
  none:  '인식 없음',
  one:   '☝️ 1손가락 — 회전',
  two:   '✌️ 2손가락 — 이동',
  pinch: '🤏 핀치 — 확대/축소',
  open:  '✋ 손 펼침 — 정지',
};

function onHandResults(results) {
  // 캔버스 클리어 & 미러 반전 (셀카 방향)
  handCtx.save();
  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
  handCtx.scale(-1, 1);
  handCtx.translate(-handCanvas.width, 0);

  // 웹캠 이미지 그리기
  handCtx.drawImage(results.image, 0, 0, handCanvas.width, handCanvas.height);

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const lm = results.multiHandLandmarks[0];

    // 랜드마크 & 연결선 그리기
    drawConnectors(handCtx, lm, HAND_CONNECTIONS, { color: '#00e5ff', lineWidth: 2 });
    drawLandmarks(handCtx, lm, { color: '#ff4081', lineWidth: 1, radius: 4 });

    handCtx.restore();

    // 제스처 분류
    const g = classifyGesture(lm);
    gestureDisplay.textContent = GESTURE_LABELS[g] || g;

    if (!stlMesh) return; // 모델 없으면 제어 안 함

    // 손목(0) 좌표 (0~1 정규화, 미러 보정)
    const wx = 1.0 - lm[0].x;
    const wy = lm[0].y;

    switch (g) {
      // ── 회전 (검지 1개) ──
      case 'one': {
        if (gesture.type === 'one') {
          const dx = (wx - gesture.prevX) * 4.0;
          const dy = (wy - gesture.prevY) * 4.0;
          stlMesh.rotation.y += dx;
          stlMesh.rotation.x += dy;
        }
        gesture.type  = 'one';
        gesture.prevX = wx;
        gesture.prevY = wy;
        break;
      }

      // ── 이동 (검지+중지) ──
      case 'two': {
        if (gesture.type === 'two') {
          const dx = (wx - gesture.prevX) *  6.0;
          const dy = (wy - gesture.prevY) * -6.0; // y 반전
          stlMesh.position.x += dx;
          stlMesh.position.y += dy;
        }
        gesture.type  = 'two';
        gesture.prevX = wx;
        gesture.prevY = wy;
        break;
      }

      // ── 확대/축소 (핀치) ──
      case 'pinch': {
        // 엄지(4) ↔ 검지(8) 거리
        const pd = dist2D(lm[4], lm[8]);
        if (gesture.type === 'pinch') {
          const delta = (pd - gesture.prevPinchDist) * 15.0;
          const newZ  = camera.position.z - delta;
          camera.position.z = Math.max(0.5, Math.min(20, newZ));
        }
        gesture.type          = 'pinch';
        gesture.prevPinchDist = pd;
        break;
      }

      // ── 정지 (손 펼침) ──
      case 'open':
        gesture.type = 'open';
        break;

      default:
        gesture.type = 'none';
    }
  } else {
    // 손이 안 보임
    handCtx.restore();
    gesture.type = 'none';
    gestureDisplay.textContent = '손을 화면에 보여주세요';
  }
}

// ═══════════════════════════════════════════════
//  이벤트 바인딩
// ═══════════════════════════════════════════════
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.stl')) {
    setStatus('STL 파일만 지원합니다 ❌', 'error');
    return;
  }
  setStatus('파일 로딩 중…', 'warn');
  const reader = new FileReader();
  reader.onload = (ev) => loadSTL(ev.target.result);
  reader.onerror = () => setStatus('파일 읽기 오류 ❌', 'error');
  reader.readAsArrayBuffer(file);
});

// 드래그 앤 드롭
const viewerEl = document.getElementById('viewer-container');
viewerEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('drag-over');
});
viewerEl.addEventListener('dragleave', () => document.body.classList.remove('drag-over'));
viewerEl.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.name.toLowerCase().endsWith('.stl')) {
    const reader = new FileReader();
    reader.onload = (ev) => loadSTL(ev.target.result);
    reader.readAsArrayBuffer(file);
  }
});

camBtn.addEventListener('click', () => {
  if (cameraActive) stopCamera();
  else startCamera();
});

resetBtn.addEventListener('click', resetView);

// ═══════════════════════════════════════════════
//  앱 부트스트랩
// ═══════════════════════════════════════════════
window.addEventListener('load', async () => {
  initThree();
  initMediaPipe();
  loadingEl.classList.add('hidden');
  setStatus('STL 파일을 업로드하세요');
});
