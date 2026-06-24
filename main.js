'use strict';

let scene, camera, renderer, stlMesh;
let hands, mpCamera;
let cameraActive = false;

// DOM 캐싱 리스트
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

// 시각 동기화 트래킹 프레임 데이터 구조체
const trackingFrame = {
  activeGesture: 'none',
  lastAnchorX: 0,
  lastAnchorY: 0
};

// ── 3D 그래픽스 엔진 초기화 ──
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
  renderer.toneMappingExposure = 1.2;

  // 조명 설정
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambientLight);

  const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
  mainLight.position.set(4, 8, 5);
  scene.add(mainLight);

  const fillLight = new THREE.DirectionalLight(0xa6d2ff, 0.4);
  fillLight.position.set(-4, -2, -3);
  scene.add(fillLight);

  const gridSystem = new THREE.GridHelper(20, 40, 0xadb5bd, 0xe9ecef);
  gridSystem.position.y = -1.5;
  scene.add(gridSystem);

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  // 실시간 렌더링 루프
  function renderTick() {
    requestAnimationFrame(renderTick);
    
    // ⭐ [수정 완료] 가만히 있을 때 혼자 돌던 자동 회전 코드 제거!
    
    renderer.render(scene, camera);
  }
  renderTick();
}

// ── STL 파서 및 인스턴싱 ──
function parseStlBinaryOrAscii(arrayBuffer) {
  const uint8View = new Uint8Array(arrayBuffer);
  const isAsciiFormat = () => {
    const sampleText = new TextDecoder().decode(uint8View.slice(0, 128));
    return sampleText.trim().startsWith('solid');
  };

  const geometry = new THREE.BufferGeometry();
  const parsedVertices = [];
  const parsedNormals = [];

  if (isAsciiFormat()) {
    const rawContent = new TextDecoder().decode(uint8View);
    const lines = rawContent.split('\n');
    let currentNormal = [0, 0, 0];

    for (let i = 0; i < lines.length; i++) {
      const parsedLine = lines[i].trim();
      if (parsedLine.startsWith('facet normal')) {
        const chunk = parsedLine.split(/\s+/);
        currentNormal = [parseFloat(chunk[2]), parseFloat(chunk[3]), parseFloat(chunk[4])];
      } else if (parsedLine.startsWith('vertex')) {
        const chunk = parsedLine.split(/\s+/);
        parsedVertices.push(parseFloat(chunk[1]), parseFloat(chunk[2]), parseFloat(chunk[3]));
        parsedNormals.push(...currentNormal);
      }
    }
  } else {
    const dataView = new DataView(arrayBuffer);
    const totalTriangles = dataView.getUint32(80, true);

    for (let i = 0; i < totalTriangles; i++) {
      const memoryOffset = 84 + i * 50;
      const nx = dataView.getFloat32(memoryOffset, true);
      const ny = dataView.getFloat32(memoryOffset + 4, true);
      const nz = dataView.getFloat32(memoryOffset + 8, true);

      for (let v = 0; v < 3; v++) {
        const vertexOffset = memoryOffset + 12 + v * 12;
        parsedVertices.push(
          dataView.getFloat32(vertexOffset, true),
          dataView.getFloat32(vertexOffset + 4, true),
          dataView.getFloat32(vertexOffset + 8, true)
        );
        parsedNormals.push(nx, ny, nz);
      }
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(parsedVertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(parsedNormals, 3));
  return geometry;
}

function renderStlToScene(buffer) {
  try {
    const geometry = parseStlBinaryOrAscii(buffer);

    if (stlMesh) {
      scene.remove(stlMesh);
      stlMesh.geometry.dispose();
      stlMesh.material.dispose();
    }

    geometry.computeBoundingBox();
    const boundBox = geometry.boundingBox;
    const centerVector = new THREE.Vector3();
    boundBox.getCenter(centerVector);
    geometry.translate(-centerVector.x, -centerVector.y, -centerVector.z);

    const sizeVector = new THREE.Vector3();
    boundBox.getSize(sizeVector);
    const maxDimension = Math.max(sizeVector.x, sizeVector.y, sizeVector.z);
    const dynamicScale = 3.5 / maxDimension;

    const premiumMaterial = new THREE.MeshStandardMaterial({
      color: 0x4dabf7,
      metalness: 0.2,
      roughness: 0.3,
      side: THREE.DoubleSide
    });

    stlMesh = new THREE.Mesh(geometry, premiumMaterial);
    stlMesh.scale.setScalar(dynamicScale);
    stlMesh.rotation.x = -Math.PI / 2;
    scene.add(stlMesh);

    resetCameraViewport();
    updateUiStatus('오브젝트 마운트 완결 ✅', 'ready');
  } catch (ex) {
    console.error(ex);
    updateUiStatus('구조 해석 실패 및 규격 외 파일 ❌', 'error');
  }
}

// ── 인터페이스 동기화 및 뷰포트 초기화 ──
function resetCameraViewport() {
  camera.position.set(0, 0, 6);
  camera.lookAt(0, 0, 0);
  if (stlMesh) {
    stlMesh.position.set(0, 0, 0);
    stlMesh.rotation.set(-Math.PI / 2, 0, 0);
  }
  updateUiStatus('뷰포트 정렬 초기화 스캔', 'ready');
}

btnZoomIn.addEventListener('click', () => { camera.position.z = Math.max(1, camera.position.z - 0.5); });
btnZoomOut.addEventListener('click', () => { camera.position.z = Math.min(25, camera.position.z + 0.5); });
btnRotLeft.addEventListener('click', () => { if (stlMesh) stlMesh.rotation.z -= 0.2; });
btnRotRight.addEventListener('click', () => { if (stlMesh) stlMesh.rotation.z += 0.2; });

btnDemo.addEventListener('click', () => {
  const mockGeometry = new THREE.BoxGeometry(2, 2, 2);
  const mockMaterial = new THREE.MeshStandardMaterial({ color: 0xff922b, metalness: 0.4, roughness: 0.2 });
  if (stlMesh) scene.remove(stlMesh);
  stlMesh = new THREE.Mesh(mockGeometry, mockMaterial);
  scene.add(stlMesh);
  resetCameraViewport();
  updateUiStatus('샘플 프리셋 빌드 로드 완료', 'ready');
});

// ── 손가락 상태 체크 헬퍼 ──
function checkFingerState(landmarks, tipIndex, dipIndex) {
  return landmarks[tipIndex].y < landmarks[dipIndex].y;
}

// ⭐ [알고리즘 개정] 모션 인식의 조건 강화 및 의도치 않은 회전 예방
function processGestureParsing(landmarks) {
  // 각 손가락이 위로 명확히 펴졌는지 판별
  const thumbState  = landmarks[4].x < landmarks[3].x; 
  const indexState  = checkFingerState(landmarks, 8, 6);
  const middleState = checkFingerState(landmarks, 12, 10);
  const ringState   = checkFingerState(landmarks, 16, 14);
  const pinkyState  = checkFingerState(landmarks, 20, 18);

  const activeFingersCount = [thumbState, indexState, middleState, ringState, pinkyState].filter(Boolean).length;

  // 1. 🖐️ 보자기 (대부분 펼침) -> 확대
  if (activeFingersCount >= 4) return 'zoom_in';
  
  // 2. ✊ 주먹 (전부 구부림) -> 축소
  if (activeFingersCount === 0) return 'zoom_out';
  
  // 3. ✌️ 브이 (검지, 중지만 펴짐) -> 시선 평면 이동
  if (indexState && middleState && !ringState && !pinkyState) return 'pan';
  
  // 4. ☝️ 검지 하나 (오직 검지만 펼쳐져 있고 타 손가락이 완전히 접혔을 때만 회전 인정)
  if (indexState && !middleState && !ringState && !pinkyState) return 'rotate';

  // 위 조건에 명확하게 맞아떨어지지 않는 애매한 손동작은 무조건 조작 무시(안정 상태유지)
  return 'none';
}

// ── MEDIAPIPE PIPELINE HANDLER ──
function onCaptureResultHandler(results) {
  handCtx.save();
  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
  
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const singleHandPoints = results.multiHandLandmarks[0];
    
    drawConnectors(handCtx, singleHandPoints, HAND_CONNECTIONS, { color: '#4dabf7', lineWidth: 3 });
    drawLandmarks(handCtx, singleHandPoints, { color: '#ff922b', lineWidth: 1, radius: 5 });

    const computedGesture = processGestureParsing(singleHandPoints);
    
    const uiLabels = {
      none: '안정화 대기 모드 (정지)',
      rotate: '☝️ 궤도 회전 제어 중',
      pan: '✌️ 평면 초점 이동 중',
      zoom_in: '🖐️ 초점 전진 (Zoom In)',
      zoom_out: '✊ 초점 후퇴 (Zoom Out)'
    };
    
    gestureDisplay.textContent = uiLabels[computedGesture] || '추적 불능';

    if (stlMesh) {
      // 손가락 끝 대신 왜곡이 최소화되는 '손바닥 중앙(9번 마디)'을 제어 기준점으로 세팅
      const currentX = singleHandPoints[9].x;
      const currentY = singleHandPoints[9].y;

      switch (computedGesture) {
        case 'rotate':
          if (trackingFrame.activeGesture === 'rotate') {
            const deltaX = (currentX - trackingFrame.lastAnchorX) * 5.0;
            const deltaY = (currentY - trackingFrame.lastAnchorY) * 5.0;
            
            // 미세 손떨림 무시용 데드존 필터 스크리닝
            if (Math.abs(deltaX) > 0.005) stlMesh.rotation.y += deltaX;
            if (Math.abs(deltaY) > 0.005) stlMesh.rotation.x += deltaY;
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
          camera.position.z = Math.max(1.5, camera.position.z - 0.08);
          break;
        case 'zoom_out':
          camera.position.z = Math.min(22.0, camera.position.z + 0.08);
          break;
      }

      // 현재 추적 좌표 백업 업데이트
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

// ── CAMERA VISION CONTROL ──
async function bootCameraVision() {
  try {
    const videoStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' }
    });
    webcamVideo.srcObject = videoStream;
    await webcamVideo.play();

    handCanvas.width = webcamVideo.videoWidth || 640;
    handCanvas.height = webcamVideo.videoHeight || 480;

    mpCamera = new Camera(webcamVideo, {
      onFrame: async () => { if (cameraActive) await hands.send({ image: webcamVideo }); },
      width: 640,
      height: 480
    });
    mpCamera.start();
    cameraActive = true;
    updateUiStatus('비전 엔진 정상 작동 계측 개시', 'ready');
  } catch (err) {
    console.error(err);
    updateUiStatus('비디오 이미징 권한 에러 ❌', 'error');
  }
}

function terminateCameraVision() {
  if (mpCamera) { mpCamera.stop(); mpCamera = null; }
  if (webcamVideo.srcObject) {
    webcamVideo.srcObject.getTracks().forEach(track => track.stop());
    webcamVideo.srcObject = null;
  }
  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
  cameraActive = false;
  gestureDisplay.textContent = '카메라 셧다운';
  updateUiStatus('분석 카메라 정지 상태', '');
}

function updateUiStatus(msg, statusClass = '') {
  statusBadge.textContent = msg;
  statusBadge.className = statusClass;
}

fileInput.addEventListener('change', (e) => {
  const targetFile = e.target.files[0];
  if (!targetFile) return;
  if (!targetFile.name.toLowerCase().endsWith('.stl')) {
    updateUiStatus('올바르지 않은 확장자 스캔 필터 ❌', 'error');
    return;
  }
  updateUiStatus('파일 바이너리 디코딩 로드 중...', 'warn');
  const fileReader = new FileReader();
  fileReader.onload = (evt) => renderStlToScene(evt.target.result);
  fileReader.readAsArrayBuffer(targetFile);
});

const dropZone = document.getElementById('viewer-container');
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => document.body.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('drag-over');
  const targetFile = e.dataTransfer.files[0];
  if (targetFile && targetFile.name.toLowerCase().endsWith('.stl')) {
    const fileReader = new FileReader();
    fileReader.onload = (evt) => renderStlToScene(evt.target.result);
    fileReader.readAsArrayBuffer(targetFile);
  }
});

camBtn.addEventListener('click', () => { if (cameraActive) terminateCameraVision(); else bootCameraVision(); });
resetBtn.addEventListener('click', resetCameraViewport);

window.addEventListener('load', () => {
  initThreeEngine();
  hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
  hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.6 });
  hands.onResults(onCaptureResultHandler);
  loadingEl.classList.add('hidden');
  updateUiStatus('대기 중 — 데이터를 추가하세요');
});
