# Shannon Manifold

Shannon Manifold는 `Lean4 기반 증명 작성`, `PDF 기반 정리 업로드`, `RAG 검색`, `Gemini 챗봇`, `Verified Database`, `Lean import graph`를 하나로 묶은 Docker-first 연구 프로토타입입니다.

핵심 목표는 다음 두 가지입니다.

- 사용자가 Lean 코드를 직접 작성하고 검증 가능한 형태로 관리할 수 있게 하기
- PDF와 기존 증명 데이터를 바탕으로 formal proof workflow를 보조하기

## 1. 주요 기능

### Lean Playground

- 브라우저에서 Lean4 코드를 작성할 수 있습니다.
- `infoview`를 통해 proof state, goal, 오류 메시지를 확인할 수 있습니다.
- `mathlib`를 사용할 수 있습니다.
- 작성한 코드는 shared Lean workspace와 GitHub repository로 저장할 수 있습니다.
- 로컬 PDF를 Playground에 첨부한 뒤 `Save / Push` 시 Lean 코드와 함께 verified database에 반영할 수 있습니다.

### Verified Database

- 사용자가 업로드하거나 저장한 Lean 코드를 목록으로 보여줍니다.
- 항목을 클릭하면 전용 코드 뷰어에서 내용을 확인할 수 있습니다.
- 코드 하이라이팅을 지원합니다.
- PDF가 연결된 항목은 미리보기와 다운로드를 지원합니다.
- 목록과 코드 열람은 공개입니다.
- 수정은 작성자만 가능하고, 삭제는 작성자 또는 관리자만 가능합니다.

### Lean Import Manifold

- verified Lean 문서들의 `import` 관계를 그래프로 시각화합니다.
- 노드를 클릭하면 해당 코드 상세 화면으로 이동합니다.
- 자동 polling은 하지 않고, 사용자가 `Refresh`를 눌렀을 때만 새로고침합니다.

### Chatbot

- 현재 기본 provider는 `Gemini`입니다.
- Lean Playground의 현재 코드, imports, cursor 위치, proof state, active goal을 함께 사용합니다.
- PDF와 이미지 파일 첨부를 지원합니다.
- Lean Playground에 로컬로 첨부한 PDF는 챗봇에도 자동으로 전달됩니다.
- 답변에 포함된 ` ```lean ` 코드는 하이라이팅되어 렌더링되며 Playground에 바로 적용할 수 있습니다.

### 회원 관리

- 이메일 기반 회원가입/로그인
- Google 로그인
- 관리자 계정 bootstrap

## 2. 아키텍처

### 서비스 구성

- `frontend`
  - React + TypeScript + Vite
  - 포트 `5173`
- `backend`
  - FastAPI + SQLAlchemy
  - 포트 `8000`
- `lean-server`
  - Express + WebSocket bridge + Lean server
  - 포트 `8080`
- `mysql`
  - 사용자, proof workspace, verified code 메타데이터 저장
  - 포트 `3306`
- `qdrant`
  - 벡터 인덱스 저장
  - 포트 `6333`, `6334`

### 데이터 흐름

1. 사용자가 Lean Playground에서 코드를 작성합니다.
2. 필요하면 PDF를 로컬로 첨부합니다.
3. `Save / Push`를 누르면:
   - Lean 파일이 shared workspace에 저장됩니다.
   - Lean module build가 수행됩니다.
   - proof workspace 또는 playground document가 DB/RAG에 동기화됩니다.
   - GitHub 설정이 있으면 repository에도 push됩니다.
4. 저장된 문서는 Verified Database와 Import Graph에 반영됩니다.

## 3. 디렉터리 구조

```text
.
├── backend/          # FastAPI API, DB 모델, RAG, auth, proof pipeline
├── frontend/         # React UI, Lean Playground, chatbot, verified viewer
├── lean-server/      # Lean WebSocket/HTTP bridge
├── lean-workspace/   # 실제 Lean 4 package 및 공유 workspace
├── .devcontainer/    # 단일 full-stack devcontainer
├── docker-compose.yml
├── .env.example
└── README.md
```

## 4. 실행 방법

### 권장: Docker Compose

루트 `.env`를 준비한 뒤 실행합니다.

```bash
docker compose up --build
```

접속 주소:

- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend: [http://localhost:8000](http://localhost:8000)
- Lean Server: [http://localhost:8080](http://localhost:8080)
- Qdrant: [http://localhost:6333](http://localhost:6333)

### 첫 기동 시 참고

`lean-server`는 첫 실행에서 Lean toolchain과 `mathlib`을 준비하므로 시간이 꽤 걸릴 수 있습니다. 이 동안 frontend와 backend는 먼저 뜰 수 있지만, Lean Playground의 완전한 준비는 조금 늦을 수 있습니다.

## 5. 개발 컨테이너

이 저장소는 단일 full-stack devcontainer 구성을 포함합니다.

- workspace root: 저장소 루트
- 포함 런타임: Node.js + Python
- 자동 서버 실행 없음

devcontainer 안에서 수동 실행:

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

```bash
cd frontend
npm run dev -- --host 0.0.0.0
```

Lean Playground까지 함께 쓰려면 Docker Compose의 `lean-server`를 같이 올리는 것을 권장합니다.

## 6. 환경 변수

모든 런타임 설정은 루트 `.env`에서 관리합니다. 예시는 [.env.example](/Users/iinsu/.codex/worktrees/2370/shannon-manifold/.env.example)에 있습니다.

### 필수에 가까운 값

- `JWT_SECRET_KEY`
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_ROOT_PASSWORD`

### 챗봇

- `CHATBOT_PROVIDER=gemini`
- `CHATBOT_API_BASE_URL=https://generativelanguage.googleapis.com/v1beta`
- `CHATBOT_API_KEY=...`
- `CHATBOT_MODEL=gemini-2.5-flash`

### Google 로그인

- `GOOGLE_CLIENT_ID`
- `VITE_GOOGLE_CLIENT_ID`

Google OAuth client의 Authorized JavaScript origin에는 `http://localhost:5173`를 추가해야 합니다.

### GitHub push

- `GITHUB_REPOSITORY_URL`
- `GITHUB_REPOSITORY_BRANCH`
- `GITHUB_ACCESS_TOKEN`
- `VITE_GITHUB_REPOSITORY_URL`

권장 권한:

- public repository: `public_repo`
- private repository: `repo`

또는 fine-grained token에서 대상 저장소 하나만 선택하고 `Contents: Read and write`

### RAG

- `QDRANT_URL`
- `QDRANT_API_KEY` (로컬 Docker면 보통 비워둠)
- `EMBEDDING_PROVIDER`
- `EMBEDDING_API_KEY` (외부 embedding provider를 쓸 때만)

## 7. Lean Workspace

shared Lean workspace는 [lean-workspace](/Users/iinsu/.codex/worktrees/2370/shannon-manifold/lean-workspace)에 있습니다.

- 기본 Playground 저장 파일: `ShannonManifold/Playground.lean`
- 실제 저장 시에는 문서 제목 기준으로 `.lean` 파일이 생성될 수 있습니다.
- `mathlib` 의존성이 이미 포함되어 있습니다.

예시:

```lean
import Mathlib

#check Nat.succ
```

로컬에서 직접 확인:

```bash
cd lean-workspace
lake build
```

## 8. 사용자 흐름

### Lean 코드 작성

1. 로그인
2. `Lean Playground` 진입
3. Lean 코드 작성
4. 필요하면 PDF 첨부
5. `Save / Push`
6. 메인 화면의 Verified Database와 Import Graph에서 결과 확인

### PDF + Lean 코드 묶기

1. Playground에서 PDF 첨부
2. PDF는 그 시점엔 로컬 상태로만 유지
3. `Save / Push` 시 Lean 코드와 함께 proof workspace에 저장
4. Verified Database에서 코드와 PDF를 함께 열람

## 9. 주요 API

### 인증

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/google`
- `GET /auth/me`

### 챗봇

- `POST /chat/`
  - 인증 필요
  - JSON 또는 multipart 요청 지원
  - PDF / 이미지 첨부 가능

### Proof / Verified Code

- `GET /theorems/`
  - 공개
- `GET /theorems/{id}`
  - 공개
- `GET /theorems/{id}/pdf`
  - 공개
- `PUT /theorems/{id}`
  - 작성자만
- `DELETE /theorems/{id}`
  - 작성자 또는 관리자

### Lean Workspace

- `GET /lean-workspace/`
- `GET /lean-workspace/import-graph`
- `POST /lean-workspace/sync-playground`
- `POST /lean-workspace/push-playground`

### Proof Workspace

- `GET /proofs/`
- `GET /proofs/{id}`
- `POST /proofs/manual`
- `POST /proofs/upload-pdf`
- `PUT /proofs/{id}`
- `POST /proofs/{id}/regenerate`

## 10. DB 확인

### MySQL

```bash
docker compose exec mysql sh -lc 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -D "$MYSQL_DATABASE"'
```

### Qdrant 컬렉션 확인

```bash
curl http://localhost:6333/collections
```

```bash
curl -X POST http://localhost:6333/collections/shannon_manifold_chunks/points/count \
  -H 'Content-Type: application/json' \
  -d '{"exact": true}'
```

## 11. 운영 / AWS 메모

- `DATABASE_URL` 또는 `MYSQL_*` 둘 다 지원합니다.
- 로컬 MySQL 대신 AWS RDS로 교체할 수 있습니다.
- proof 업로드 저장소는 현재 로컬 경로 기반이므로, 운영에서는 EFS 또는 S3 기반 구조로 바꾸는 것이 적절합니다.
- `lean-server`는 별도 서비스로 유지하는 것이 좋습니다.
- 현재는 startup 시 `Base.metadata.create_all()`을 사용하므로, 운영 배포 전에는 migration 체계 도입을 권장합니다.

## 12. 현재 주의사항

- `lean-server` 첫 부팅은 오래 걸릴 수 있습니다.
- 프론트 번들에 Lean 관련 자산이 커서 build 결과 chunk 경고가 발생할 수 있습니다.
- Playground는 shared workspace를 사용하므로, 여러 사용자가 같은 문서 제목으로 저장하면 같은 경로를 덮어쓸 수 있습니다.

## 13. 빠른 체크리스트

### 로컬 개발 전

- `.env` 작성
- Gemini API key 입력
- 필요하면 Google client ID 입력
- 필요하면 GitHub token 입력

### 실행 후

- 로그인 가능한지 확인
- Lean Playground 열리는지 확인
- `Save / Push` 후 Verified Database에 코드가 보이는지 확인
- Import Graph에서 노드 클릭이 동작하는지 확인
- 챗봇이 Lean 코드 / PDF / 이미지 첨부를 받는지 확인
