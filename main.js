'use strict';

// ═══════════════════════════════════════
//  DOM refs
// ═══════════════════════════════════════
const loadingEl     = document.getElementById('loading');
const statusPill    = document.getElementById('status-pill');
const gestureBadge  = document.getElementById('gesture-badge');
const dropHint      = document.getElementById('drop-hint');
const fileInput     = document.getElementById('file-input');
const camBtn        = document.getElementById('cam-btn');
const resetBtn      = document.getElementById('reset-btn');
const webcamVideo   = document.getElementById('webcam-video');
const handCanvas    = document.getElementById('hand-canvas');
const handCtx       = handCanvas.getContext('2d');

// ═══════════════════════════════════════
//  Three.js globals
// ═══════════════════════════════════════
let scene, camera, renderer, stlMesh;
let animId = null;

// ═══════════════════════════════════════
//  MediaPipe globals
// ═══════════════════════════════════════
let handsDetector = null;
let mpCam         = null;
let cameraActive  = false;

// ═══════════════════════════════════════
//  제스처 상태
// ═══════════════════════════════════════
const gState = {
  type: 'none',
  prevX: 0,
  prevY: 0,
};

// 배지 자동 숨김 타이머
let badgeTimer = null;

// ═══════════════════════════════════════
//  Three.js 초기화
// ═══════════════════════════════════════
function initThree() {
  const wrap   = document.getElementById('viewer-wrap');
  const canvas = document.getElementById('three-canvas');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0f2f8);

  camera = new THREE.PerspectiveCamera(45, wrap.clientWidth / wrap.clientHeight, 0.01, 10000);
  camera.position.set(0, 0, 6);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  renderer.shadowMap.enabled = true;

  // 조명
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir1 = new THREE.DirectionalLight(0xffffff, 0.9);
  dir1.position.set(5, 8, 6);
  scene.add(dir1);
  const dir2 = new THREE.DirectionalLight(0xaabbff, 0.3);
  dir2.position.set(-5, -3, -4);
  scene.add(dir2);

  // 리사이즈
  const ro = new ResizeObserver(() => {
    camera.aspect = wrap.clientWidth / wrap.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  });
  ro.observe(wrap);

  // 렌더 루프
  function loop() {
    animId = requestAnimationFrame(loop);
    renderer.render(scene, camera);
  }
  loop();
}

// ═══════════════════════════════════════
//  STL 파서 (ASCII + Binary 인라인)
// ═══════════════════════════════════════
function parseSTL(buffer) {
  const uint8 = new Uint8Array(buffer);
  const head  = new TextDecoder().decode(uint8.slice(0, 80));
  const isASCII = head.trimStart().startsWith('solid') && !/[^\x09\x0A\x0D\x20-\x7E]/.test(head);

  const positions = [];
  const normals   = [];

  if (isASCII) {
    const text  = new TextDecoder().decode(uint8);
    let normal  = [0, 0, 1];
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('facet normal')) {
        const p = line.split(/\s+/);
        normal = [+p[2], +p[3], +p[4]];
      } else if (line.startsWith('vertex')) {
        const p = line.split(/\s+/);
        positions.push(+p[1], +p[2], +p[3]);
        normals.push(...normal);
      }
    }
  } else {
    const view  = new DataView(buffer);
    const count = view.getUint32(80, true);
    for (let i = 0; i < count; i++) {
      const base = 84 + i * 50;
      const nx = view.getFloat32(base,     true);
      const ny = view.getFloat32(base + 4, true);
      const nz = view.getFloat32(base + 8, true);
      for (let v = 0; v < 3; v++) {
        const vb = base + 12 + v * 12;
        positions.push(
          view.getFloat32(vb,     true),
          view.getFloat32(vb + 4, true),
          view.getFloat32(vb + 8, true)
        );
        normals.push(nx, ny, nz);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));
  return geo;
}

// ═══════════════════════════════════════
//  STL 로드
// ═══════════════════════════════════════
function loadSTL(buffer) {
  try {
    const geo = parseSTL(buffer);

    if (stlMesh) {
      scene.remove(stlMesh);
      stlMesh.geometry.dispose();
      stlMesh.material.dispose();
      stlMesh = null;
    }

    // 중심 정렬 & 스케일 정규화
    geo.computeBoundingBox();
    const box    = geo.boundingBox;
    const center = new THREE.Vector3();
    box.getCenter(center);
    geo.translate(-center.x, -center.y, -center.z);

    const size  = new THREE.Vector3();
    box.getSize(size);
    const scale = 3.2 / Math.max(size.x, size.y, size.z);

    const mat = new THREE.MeshPhongMaterial({
      color:     0x3b6ef8,
      specular:  0x99b4ff,
      shininess: 80,
      side:      THREE.DoubleSide,
    });

    stlMesh = new THREE.Mesh(geo, mat);
    stlMesh.scale.setScalar(scale);
    stlMesh.rotation.x = -Math.PI / 2;
    scene.add(stlMesh);

    dropHint.classList.add('hidden');
    resetView();
    setStatus('로드 완료 ✓', 'ready');
  } catch (e) {
    console.error(e);
    setStatus('파싱 오류 ✕', 'error');
  }
}

// ═══════════════════════════════════════
//  뷰 초기화
// ═══════════════════════════════════════
function resetView() {
  camera.position.set(0, 0, 6);
  camera.lookAt(0, 0, 0);
  if (stlMesh) {
    stlMesh.position.set(0, 0, 0);
    stlMesh.rotation.set(-Math.PI / 2, 0, 0);
  }
}

// ═══════════════════════════════════════
//  상태 표시
// ═══════════════════════════════════════
function setStatus(msg, type = '') {
  statusPill.textContent = msg;
  statusPill.className   = type;
}

function showBadge(text) {
  gestureBadge.textContent = text;
  gestureBadge.classList.add('show');
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => gestureBadge.classList.remove('show'), 1800);
}

// ═══════════════════════════════════════
//  마우스 드래그 조작
// ═══════════════════════════════════════
(function initMouseControl() {
  const canvas = document.getElementById('three-canvas');
  let down = false, lastX = 0, lastY = 0;

  canvas.addEventListener('mousedown', e => {
    down = true; lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener('mouseup',   () => { down = false; });
  window.addEventListener('mousemove', e => {
    if (!down || !stlMesh) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;

    if (e.shiftKey) {
      // Shift + 드래그 → 이동
      stlMesh.position.x += dx * 0.008;
      stlMesh.position.y -= dy * 0.008;
    } else {
      // 드래그 → 회전
      stlMesh.rotation.y += dx * 0.012;
      stlMesh.rotation.x += dy * 0.012;
    }
  });

  // 휠 → 줌
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const z = camera.position.z + e.deltaY * 0.01;
    camera.position.z = Math.max(0.5, Math.min(20, z));
  }, { passive: false });

  // 터치 (모바일)
  let touchPrev = null;
  let pinchPrev = 0;
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) touchPrev = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchPrev = Math.hypot(dx, dy);
    }
  });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (!stlMesh) return;
    if (e.touches.length === 1 && touchPrev) {
      const dx = e.touches[0].clientX - touchPrev.x;
      const dy = e.touches[0].clientY - touchPrev.y;
      stlMesh.rotation.y += dx * 0.012;
      stlMesh.rotation.x += dy * 0.012;
      touchPrev = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const delta = (dist - pinchPrev) * 0.03;
      camera.position.z = Math.max(0.5, Math.min(20, camera.position.z - delta));
      pinchPrev = dist;
    }
  }, { passive: false });
})();

// ═══════════════════════════════════════
//  버튼 조작
// ═══════════════════════════════════════
function bindBtn(id, fn) {
  const el = document.getElementById(id);
  if (!el) return;

  let iv = null;
  const start = () => { fn(); iv = setInterval(fn, 60); };
  const stop  = () => clearInterval(iv);

  el.addEventListener('mousedown',  start);
  el.addEventListener('touchstart', e => { e.preventDefault(); start(); }, { passive: false });
  el.addEventListener('mouseup',    stop);
  el.addEventListener('mouseleave', stop);
  el.addEventListener('touchend',   stop);
}

function initButtonControls() {
  const ROT  = 0.04;
  const MOVE = 0.06;
  const ZOOM = 0.08;

  bindBtn('btn-rot-left',  () => stlMesh && (stlMesh.rotation.y -= ROT));
  bindBtn('btn-rot-right', () => stlMesh && (stlMesh.rotation.y += ROT));
  bindBtn('btn-rot-up',    () => stlMesh && (stlMesh.rotation.x -= ROT));
  bindBtn('btn-rot-down',  () => stlMesh && (stlMesh.rotation.x += ROT));

  bindBtn('btn-move-left',  () => stlMesh && (stlMesh.position.x -= MOVE));
  bindBtn('btn-move-right', () => stlMesh && (stlMesh.position.x += MOVE));
  bindBtn('btn-move-up',    () => stlMesh && (stlMesh.position.y += MOVE));
  bindBtn('btn-move-down',  () => stlMesh && (stlMesh.position.y -= MOVE));

  bindBtn('btn-zoom-in',  () => { camera.position.z = Math.max(0.5, camera.position.z - ZOOM); });
  bindBtn('btn-zoom-out', () => { camera.position.z = Math.min(20,  camera.position.z + ZOOM); });
}

// ═══════════════════════════════════════
//  손 제스처 분류 (개선)
// ═══════════════════════════════════════
function fingerUp(lm, tip, pip) { return lm[tip].y < lm[pip].y; }

function classifyHand(lm) {
  const thumbUp  = lm[4].x < lm[3].x;   // 오른손 기준 엄지 펼침 (x축)
  const indexUp  = fingerUp(lm, 8,  6);
  const middleUp = fingerUp(lm, 12, 10);
  const ringUp   = fingerUp(lm, 16, 14);
  const pinkyUp  = fingerUp(lm, 20, 18);

  const ext = [thumbUp, indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;

  // 손 펼침: 4개 이상
  if (ext >= 4) return 'open';

  // 엄지만 위 + 나머지 접힘 → 확대
  if (thumbUp && !indexUp && !middleUp && !ringUp && !pinkyUp) return 'thumb_up';

  // 엄지+새끼만 → 축소
  if (thumbUp && !indexUp && !middleUp && !ringUp && pinkyUp) return 'pinky';

  // 검지+중지 → 이동
  if (indexUp && middleUp && !ringUp && !pinkyUp) return 'two';

  // 검지만 → 회전
  if (indexUp && !middleUp) return 'one';

  return 'none';
}

// ═══════════════════════════════════════
//  MediaPipe 초기화
// ═══════════════════════════════════════
function initMediaPipe() {
  handsDetector = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
  });
  handsDetector.setOptions({
    maxNumHands:            1,
    modelComplexity:        1,
    minDetectionConfidence: 0.75,
    minTrackingConfidence:  0.65,
  });
  handsDetector.onResults(onHandResults);
}

// ═══════════════════════════════════════
//  웹캠 시작 / 정지
// ═══════════════════════════════════════
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
    });
    webcamVideo.srcObject = stream;
    await webcamVideo.play();

    handCanvas.width  = 640;
    handCanvas.height = 480;

    mpCam = new Camera(webcamVideo, {
      onFrame: async () => { await handsDetector.send({ image: webcamVideo }); },
      width: 640, height: 480,
    });
    mpCam.start();

    cameraActive = true;
    camBtn.textContent = '📷 손 인식 끄기';
    camBtn.classList.add('active');
    setStatus('카메라 활성화', 'ready');
  } catch (err) {
    console.error(err);
    setStatus('카메라 권한 필요 ✕', 'error');
  }
}

function stopCamera() {
  mpCam?.stop(); mpCam = null;
  webcamVideo.srcObject?.getTracks().forEach(t => t.stop());
  webcamVideo.srcObject = null;
  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
  cameraActive = false;
  camBtn.textContent = '📷 손 인식 시작';
  camBtn.classList.remove('active');
  gState.type = 'none';
  gestureBadge.classList.remove('show');
  setStatus(stlMesh ? '로드 완료 ✓' : 'STL을 업로드하세요', stlMesh ? 'ready' : '');
}

// ═══════════════════════════════════════
//  손 인식 결과 처리
// ═══════════════════════════════════════
const BADGE_MAP = {
  one:      '☝️ 회전 중',
  two:      '✌️ 이동 중',
  thumb_up: '👍 확대 중',
  pinky:    '🤙 축소 중',
  open:     '✋ 정지',
  none:     '손 감지됨',
};

const ZOOM_SPEED = 0.03;

function onHandResults(results) {
  handCtx.save();
  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
  // 좌우 미러
  handCtx.scale(-1, 1);
  handCtx.translate(-handCanvas.width, 0);
  handCtx.drawImage(results.image, 0, 0, handCanvas.width, handCanvas.height);

  if (results.multiHandLandmarks?.length > 0) {
    const lm = results.multiHandLandmarks[0];

    drawConnectors(handCtx, lm, HAND_CONNECTIONS, { color: '#3b6ef8', lineWidth: 2 });
    drawLandmarks(handCtx, lm, { color: '#f97316', lineWidth: 1, radius: 3 });

    handCtx.restore();

    const g = classifyHand(lm);

    // 배지
    if (g !== 'none') showBadge(BADGE_MAP[g] || g);

    if (!stlMesh) { gState.type = 'none'; return; }

    // 손목(0) 미러 보정 x
    const wx = 1.0 - lm[0].x;
    const wy = lm[0].y;

    switch (g) {
      case 'one': {
        if (gState.type === 'one') {
          stlMesh.rotation.y += (wx - gState.prevX) * 5.0;
          stlMesh.rotation.x += (wy - gState.prevY) * 5.0;
        }
        gState.type = 'one'; gState.prevX = wx; gState.prevY = wy;
        break;
      }
      case 'two': {
        if (gState.type === 'two') {
          stlMesh.position.x += (wx - gState.prevX) *  7.0;
          stlMesh.position.y += (wy - gState.prevY) * -7.0;
        }
        gState.type = 'two'; gState.prevX = wx; gState.prevY = wy;
        break;
      }
      case 'thumb_up': {
        camera.position.z = Math.max(0.5, camera.position.z - ZOOM_SPEED);
        gState.type = 'thumb_up';
        break;
      }
      case 'pinky': {
        camera.position.z = Math.min(20, camera.position.z + ZOOM_SPEED);
        gState.type = 'pinky';
        break;
      }
      case 'open': {
        gState.type = 'open';
        break;
      }
      default: {
        gState.type = 'none';
      }
    }
  } else {
    handCtx.restore();
    gState.type = 'none';
  }
}

// ═══════════════════════════════════════
//  파일 이벤트
// ═══════════════════════════════════════
function readFile(file) {
  if (!file?.name.toLowerCase().endsWith('.stl')) {
    setStatus('STL 파일만 지원 ✕', 'error'); return;
  }
  setStatus('로딩 중…', 'warn');
  const r = new FileReader();
  r.onload  = e => loadSTL(e.target.result);
  r.onerror = () => setStatus('파일 읽기 오류 ✕', 'error');
  r.readAsArrayBuffer(file);
}

fileInput.addEventListener('change', e => readFile(e.target.files[0]));

const viewerWrap = document.getElementById('viewer-wrap');
viewerWrap.addEventListener('dragover',  e => { e.preventDefault(); document.body.classList.add('dragging'); });
viewerWrap.addEventListener('dragleave', ()  => document.body.classList.remove('dragging'));
viewerWrap.addEventListener('drop', e => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  readFile(e.dataTransfer.files[0]);
});

camBtn.addEventListener('click', () => cameraActive ? stopCamera() : startCamera());
resetBtn.addEventListener('click', resetView);

// ═══════════════════════════════════════
//  부트스트랩
// ═══════════════════════════════════════
window.addEventListener('load', () => {
  initThree();
  initMediaPipe();
  initButtonControls();
  loadingEl.classList.add('hidden');
  setStatus('STL을 업로드하세요');
});
