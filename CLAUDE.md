# 브롤스타즈 클론 (GitHub Pages + Firebase) — 작업 안내

사용자와는 **한국어**로 대화합니다. 이 파일은 이 저장소에서 작업하는 Claude 세션을 위한 안내입니다.

## 꼭 지킬 것
- **요청한 것만 바꾼다.** 요청하지 않은 화면·동작·디자인은 건드리지 않는다. 더 바꾸는 게 좋아 보이면 먼저 묻는다.
- 브롤러·스킬·모드 이름은 **원작 이름 그대로**, 수치·설명은 원작 공식 기준.
- 화면 배치는 사용자가 보낸 원작 사진과 같게. 새 배경이나 원작에 없는 버튼을 만들지 않는다.
- 답장마다 끝에 코드 블록으로 3줄: `YYYY/MM/DD`, `질문: HH:MM`(사용자 메시지 보낸 시각), `답변: HH:MM:SS`(시간 확인 도구로 실제 시각).
- 커밋 작성자는 `Claude <noreply@anthropic.com>` (저장소 git 설정에 이미 있음). 테스트 스크린샷 등 임시 파일을 저장소에 남기지 않는다.

## 구조
- `index.html` 한 파일이 게임 전체 (약 720KB). GitHub Pages: https://songsh09.github.io/brawl/
  - 앞쪽 `<script>`(IIFE): 게임. 블록 `{ … }` 단위로 기능이 나뉨. 함수 선언은 블록 밖에서도 보이지만 `const`/`let`은 블록 안에서만.
  - 끝의 `<script type="module">`: Firebase 모듈. `window.BSO`(온라인 API)를 만들고 `bso-loaded` 이벤트를 보냄.
  - 새 `<style>`은 `<head>`가 아니라 `<script>const TAU` 바로 앞(v6 블록 근처)에 넣어야 body 쪽 규칙에 덮이지 않음.
- Firebase 프로젝트 `brawl090417` (Realtime Database, 싱가포르 `asia-southeast1`, 익명 로그인).
  - 경로: `presence`, `codes`, `invites`, `rooms`(팀 · `rooms/{id}/chat` 팀 채팅), `signal`(WebRTC 연결 정보), `relay`(직접 연결이 안 될 때 우회), `chat`(전체 채팅, 3일 뒤 삭제).
- 온라인 전투: **방장이 계산**하고 팀원은 조작만 보냄. 연결은 WebRTC 데이터 채널(방장 중심), 안 되면 `relay` 경로(Firebase)로 우회.
  - 화면 정보는 팀원마다 "이미 가진 값"을 기억해 바뀐 값만 보냄(시작·재접속 때만 전체). 메시지 번호(`q`)가 안 이어지면 팀원이 `{t:'full'}`로 전체를 다시 요청.
- 서버(Cloud Run) 방식은 쓰지 않기로 해서 코드를 지웠음. 다시 넣지 않는다.

## Firebase 규칙
- 규칙 원본은 `database.rules.json`. **바꿔서 main에 올리면 GitHub Actions(`.github/workflows/firebase-rules.yml`)가 Firebase에 자동 적용**한다.
  - 저장소 비밀 값 `FIREBASE_SERVICE_ACCOUNT`(서비스 계정 키 JSON)가 있어야 동작. 없으면 적용을 건너뜀.
  - 적용 결과는 저장소 Actions 탭의 "Firebase 규칙 적용" 실행 기록에 남는다. 세션에서 직접 못 보면 사용자에게 초록색 체크인지 확인을 부탁한다.
  - 자동 적용이 실패했거나 비밀 값이 없으면, 사용자에게 규칙 파일을 보내고 Firebase 콘솔 → Realtime Database → 규칙에 붙여넣어 게시하라고 안내한다.
- 새 경로를 쓰는 기능을 만들면 규칙도 함께 고친다(쓰기 권한이 없으면 실제 서비스에서 조용히 실패함).

## 테스트 (실제 Firebase 없이)
- Playwright(Python) + Chromium `/opt/pw-browsers/chromium`. `www.gstatic.com`(Firebase SDK) 요청은 막고, `window.BSO`를 init script로 흉내 낸다.
- 온라인 전투는 페이지 두 개를 `BroadcastChannel`로 이어서 방장/팀원을 흉내 낸다. 백그라운드 탭 멈춤을 막으려면
  `--disable-background-timer-throttling --disable-renderer-backgrounding` 과 `requestAnimationFrame`을 `setTimeout`으로 바꾸는 init script를 쓴다.
- 문법 검사: `<script>` 내용과 모듈 내용을 각각 파일로 빼서 `node --check`.
- 화면을 바꾸지 않는 작업(최적화 등)은 바꾸기 전/후 스크린샷을 픽셀 비교해 같은지 확인한다.
