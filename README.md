# Hand Gesture STL Viewer

웹캠으로 손 제스처를 인식하여 STL 3D 모델을 제어하는 웹 앱입니다.

## 🚀 GitHub Pages 배포

1. 저장소를 만들고 세 파일(`index.html`, `main.js`, `README.md`)을 업로드합니다.
2. **Settings → Pages → Branch: main / root → Save** 로 GitHub Pages를 활성화합니다.
3. `https://<your-username>.github.io/<repo-name>/` 으로 접속합니다.

> **중요**: GitHub Pages는 HTTPS를 제공하므로 카메라 접근이 정상 작동합니다.  
> 로컬에서 테스트할 경우 `http://localhost` 또는 `https://` 환경이 필요합니다.

## ✋ 제스처 조작법

| 제스처 | 동작 |
|--------|------|
| ☝️ 검지 1개 | 모델 **회전** |
| ✌️ 검지 + 중지 | 모델 **이동** |
| 🤏 엄지 + 검지 핀치 | **확대 / 축소** |
| ✋ 손 펼치기 | **정지** |

## 📦 의존성

모두 CDN에서 자동 로드됩니다 — 별도 설치 불필요.

- [Three.js r128](https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js)
- [MediaPipe Hands](https://cdn.jsdelivr.net/npm/@mediapipe/hands/)
- [MediaPipe Camera Utils](https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/)
- [MediaPipe Drawing Utils](https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/)

## 📂 STL 파일 불러오기

- 사이드 패널의 **📂 STL 파일 업로드** 버튼 클릭
- 또는 3D 뷰어 영역에 STL 파일을 **드래그 앤 드롭**
