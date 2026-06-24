'use strict';

/* ==========================================
   GLOBALS
========================================== */

let scene;
let camera;
let renderer;

let stlMesh = null;

let hands;
let mpCamera;

let cameraActive = false;

/* ==========================================
   DOM
========================================== */

const loadingEl =
document.getElementById('loading');

const statusBadge =
document.getElementById('status-badge');

const gestureDisplay =
document.getElementById('current-gesture');

const fileInput =
document.getElementById('file-input');

const camBtn =
document.getElementById('cam-btn');

const resetBtn =
document.getElementById('reset-btn');

const webcamVideo =
document.getElementById('webcam-video');

const handCanvas =
document.getElementById('hand-canvas');

const handCtx =
handCanvas.getContext('2d');

/* ==========================================
   BUTTONS
========================================== */

const zoomInBtn =
document.getElementById('zoomInBtn');

const zoomOutBtn =
document.getElementById('zoomOutBtn');

const rotateLeftBtn =
document.getElementById('rotateLeftBtn');

const rotateRightBtn =
document.getElementById('rotateRightBtn');

const moveUpBtn =
document.getElementById('moveUpBtn');

const moveDownBtn =
document.getElementById('moveDownBtn');

const moveLeftBtn =
document.getElementById('moveLeftBtn');

const moveRightBtn =
document.getElementById('moveRightBtn');

/* ==========================================
   GESTURE STATE
========================================== */

const gesture = {

type:'none',

prevX:0,
prevY:0

};

/* ==========================================
   THREE INIT
========================================== */

function initThree(){

const container =
document.getElementById(
'viewer-container'
);

const canvas =
document.getElementById(
'three-canvas'
);

scene =
new THREE.Scene();

scene.background =
new THREE.Color(
0xf5f7fb
);

camera =
new THREE.PerspectiveCamera(

45,

container.clientWidth /
container.clientHeight,

0.01,

10000

);

camera.position.set(
0,
0,
5
);

renderer =
new THREE.WebGLRenderer({

canvas,

antialias:true

});

renderer.setPixelRatio(
window.devicePixelRatio
);

renderer.setSize(

container.clientWidth,

container.clientHeight

);

/* 조명 */

const ambient =
new THREE.AmbientLight(
0xffffff,
0.8
);

scene.add(
ambient
);

const dir1 =
new THREE.DirectionalLight(
0xffffff,
1.2
);

dir1.position.set(
5,
8,
5
);

scene.add(
dir1
);

const dir2 =
new THREE.DirectionalLight(
0xffffff,
0.4
);

dir2.position.set(
-5,
5,
-5
);

scene.add(
dir2
);

/* 그림자 원 */

const shadow =
new THREE.Mesh(

new THREE.CircleGeometry(
3,
64
),

new THREE.MeshBasicMaterial({

color:0x000000,

transparent:true,

opacity:0.08

})

);

shadow.rotation.x =
-Math.PI/2;

shadow.position.y =
-1.6;

scene.add(
shadow
);

/* Grid */

const grid =
new THREE.GridHelper(

10,
20,

0xdbe7ff,
0xeaf1ff

);

grid.name =
'grid';

scene.add(
grid
);

window.addEventListener(

'resize',

()=>{

camera.aspect =

container.clientWidth /
container.clientHeight;

camera.updateProjectionMatrix();

renderer.setSize(

container.clientWidth,

container.clientHeight

);

}

);

function animate(){

requestAnimationFrame(
animate
);

renderer.render(
scene,
camera
);

}

animate();

}

/* ==========================================
   STATUS
========================================== */

function setStatus(

msg,
type=''

){

statusBadge.textContent =
msg;

statusBadge.className =
'';

}

/* ==========================================
   RESET VIEW
========================================== */

function resetView(){

camera.position.set(
0,
0,
5
);

camera.lookAt(
0,
0,
0
);

if(stlMesh){

stlMesh.position.set(
0,
0,
0
);

stlMesh.rotation.x =
-Math.PI/2;

stlMesh.rotation.y =
0;

stlMesh.rotation.z =
0;

}

}

/* ==========================================
   BUTTON CONTROLS
========================================== */

zoomInBtn.addEventListener(

'click',

()=>{

camera.position.z -= 0.4;

if(camera.position.z < 1)
camera.position.z = 1;

}

);

zoomOutBtn.addEventListener(

'click',

()=>{

camera.position.z += 0.4;

if(camera.position.z > 20)
camera.position.z = 20;

}

);

rotateLeftBtn.addEventListener(

'click',

()=>{

if(!stlMesh) return;

stlMesh.rotation.y -= 0.2;

}

);

rotateRightBtn.addEventListener(

'click',

()=>{

if(!stlMesh) return;

stlMesh.rotation.y += 0.2;

}

);

moveLeftBtn.addEventListener(

'click',

()=>{

if(!stlMesh) return;

stlMesh.position.x -= 0.2;

}

);

moveRightBtn.addEventListener(

'click',

()=>{

if(!stlMesh) return;

stlMesh.position.x += 0.2;

}

);

moveUpBtn.addEventListener(

'click',

()=>{

if(!stlMesh) return;

stlMesh.position.y += 0.2;

}

);

moveDownBtn.addEventListener(

'click',

()=>{

if(!stlMesh) return;

stlMesh.position.y -= 0.2;

}

);

resetBtn.addEventListener(
'click',
resetView
);

/* ==========================================
   KEYBOARD
========================================== */

document.addEventListener(

'keydown',

(e)=>{

if(!stlMesh) return;

switch(e.key){

case 'ArrowLeft':

stlMesh.rotation.y -= 0.1;

break;

case 'ArrowRight':

stlMesh.rotation.y += 0.1;

break;

case 'ArrowUp':

camera.position.z -= 0.2;

break;

case 'ArrowDown':

camera.position.z += 0.2;

break;

case 'r':
case 'R':

resetView();

break;

}

}

);
/* ==========================================
   STL PARSER
========================================== */

function parseSTL(buffer){

const uint8 =
new Uint8Array(buffer);

function isASCII(buf){

const header =
new TextDecoder()
.decode(
buf.slice(0,256)
);

return header
.trimStart()
.startsWith('solid');

}

const geometry =
new THREE.BufferGeometry();

const positions = [];
const normals = [];

if(isASCII(uint8)){

const text =
new TextDecoder()
.decode(uint8);

const lines =
text.split('\n');

let normal =
[0,0,0];

for(const raw of lines){

const line =
raw.trim();

if(
line.startsWith(
'facet normal'
)
){

const p =
line.split(/\s+/);

normal = [

parseFloat(p[2]),
parseFloat(p[3]),
parseFloat(p[4])

];

}

else if(
line.startsWith(
'vertex'
)
){

const p =
line.split(/\s+/);

positions.push(

parseFloat(p[1]),
parseFloat(p[2]),
parseFloat(p[3])

);

normals.push(
...normal
);

}

}

}

else{

const view =
new DataView(buffer);

const triCount =
view.getUint32(
80,
true
);

for(

let i=0;
i<triCount;
i++

){

const offset =
84 + i*50;

const nx =
view.getFloat32(
offset,
true
);

const ny =
view.getFloat32(
offset+4,
true
);

const nz =
view.getFloat32(
offset+8,
true
);

for(
let v=0;
v<3;
v++
){

const vo =
offset + 12 + v*12;

positions.push(

view.getFloat32(
vo,
true
),

view.getFloat32(
vo+4,
true
),

view.getFloat32(
vo+8,
true
)

);

normals.push(
nx,
ny,
nz
);

}

}

}

geometry.setAttribute(

'position',

new THREE.Float32BufferAttribute(
positions,
3
)

);

geometry.setAttribute(

'normal',

new THREE.Float32BufferAttribute(
normals,
3
)

);

geometry.computeBoundingBox();

return geometry;

}

/* ==========================================
   LOAD STL
========================================== */

function loadSTL(buffer){

try{

const geometry =
parseSTL(buffer);

if(stlMesh){

scene.remove(
stlMesh
);

stlMesh.geometry.dispose();
stlMesh.material.dispose();

}

const grid =
scene.getObjectByName(
'grid'
);

if(grid)
grid.visible = false;

geometry.computeBoundingBox();

const box =
geometry.boundingBox;

const center =
new THREE.Vector3();

box.getCenter(center);

geometry.translate(

-center.x,
-center.y,
-center.z

);

const size =
new THREE.Vector3();

box.getSize(size);

const maxDim =
Math.max(
size.x,
size.y,
size.z
);

const scale =
3/maxDim;

const material =
new THREE.MeshPhongMaterial({

color:0x4f8cff,

shininess:80,

side:
THREE.DoubleSide

});

stlMesh =
new THREE.Mesh(
geometry,
material
);

stlMesh.scale.setScalar(
scale
);

stlMesh.rotation.x =
-Math.PI/2;

scene.add(
stlMesh
);

resetView();

setStatus(
'STL 로드 완료 ✅'
);

}

catch(err){

console.error(err);

setStatus(
'STL 로드 실패 ❌'
);

}

}

/* ==========================================
   FILE UPLOAD
========================================== */

fileInput.addEventListener(

'change',

(e)=>{

const file =
e.target.files[0];

if(!file)
return;

const reader =
new FileReader();

reader.onload =
(ev)=>{

loadSTL(
ev.target.result
);

};

reader.readAsArrayBuffer(
file
);

}

);

/* ==========================================
   MEDIAPIPE
========================================== */

function initMediaPipe(){

hands =
new Hands({

locateFile:(file)=>

`https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`

});

hands.setOptions({

maxNumHands:1,

modelComplexity:1,

minDetectionConfidence:0.7,

minTrackingConfidence:0.6

});

hands.onResults(
onHandResults
);

}

/* ==========================================
   CAMERA
========================================== */

async function startCamera(){

try{

const stream =

await navigator
.mediaDevices
.getUserMedia({

video:true

});

webcamVideo.srcObject =
stream;

await webcamVideo.play();

handCanvas.width =
640;

handCanvas.height =
480;

mpCamera =
new Camera(

webcamVideo,

{

onFrame:async()=>{

await hands.send({

image:webcamVideo

});

},

width:640,
height:480

}

);

mpCamera.start();

cameraActive = true;

camBtn.textContent =
'📷 카메라 끄기';

}

catch(err){

console.error(err);

}

}

function stopCamera(){

if(mpCamera){

mpCamera.stop();

mpCamera = null;

}

if(webcamVideo.srcObject){

webcamVideo.srcObject
.getTracks()
.forEach(
t=>t.stop()
);

}

cameraActive = false;

camBtn.textContent =
'📷 카메라 켜기';

}

camBtn.addEventListener(

'click',

()=>{

if(cameraActive)
stopCamera();
else
startCamera();

}

);

/* ==========================================
   GESTURE HELPERS
========================================== */

function isFingerUp(

lm,
tip,
pip

){

return lm[tip].y <
lm[pip].y;

}

function classifyGesture(lm){

const thumbUp =
lm[4].y <
lm[3].y;

const thumbDown =
lm[4].y >
lm[3].y + 0.08;

const indexUp =
isFingerUp(
lm,8,6
);

const middleUp =
isFingerUp(
lm,12,10
);

const ringUp =
isFingerUp(
lm,16,14
);

const pinkyUp =
isFingerUp(
lm,20,18
);

const count =

[
thumbUp,
indexUp,
middleUp,
ringUp,
pinkyUp

].filter(Boolean)
.length;

if(
indexUp &&
!middleUp &&
!ringUp
)
return 'rotate';

if(
indexUp &&
middleUp
)
return 'move';

if(
thumbUp &&
!indexUp
)
return 'zoomIn';

if(
thumbDown &&
!indexUp
)
return 'zoomOut';

if(
count >= 4
)
return 'open';

if(
count === 0
)
return 'fist';

return 'none';

}

/* ==========================================
   HAND RESULTS
========================================== */

function onHandResults(results){

handCtx.clearRect(
0,
0,
handCanvas.width,
handCanvas.height
);

if(

!results.multiHandLandmarks ||

results.multiHandLandmarks.length===0

){

gestureDisplay.textContent =
'손 없음';

return;

}

const lm =
results.multiHandLandmarks[0];

drawConnectors(

handCtx,
lm,
HAND_CONNECTIONS,

{
color:'#4f8cff',
lineWidth:2
}

);

drawLandmarks(

handCtx,
lm,

{
color:'#ff4d8d',
radius:4
}

);

const g =
classifyGesture(lm);

gestureDisplay.textContent =
g;

if(!stlMesh)
return;

switch(g){

case 'rotate':

stlMesh.rotation.y += 0.03;

break;

case 'move':

stlMesh.position.x += 0.02;

break;

case 'zoomIn':

camera.position.z -= 0.08;

break;

case 'zoomOut':

camera.position.z += 0.08;

break;

case 'fist':

resetView();

break;

}

}

/* ==========================================
   START
========================================== */

window.addEventListener(

'load',

()=>{

initThree();

initMediaPipe();

loadingEl.classList.add(
'hidden'
);

setStatus(
'STL 파일 업로드'
);

}

);
