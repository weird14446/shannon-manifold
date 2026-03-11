# Shannon Manifold

Shannon Manifold is a Docker-first full-stack research prototype with a FastAPI backend, a React/Vite frontend, a MySQL database for member management, and a dedicated Lean WebSocket server for the live Lean playground.

Runtime configuration is centralized in the repository root `.env` file. The committed `.env.example` shows the required variables.

## Devcontainer

The development container now opens the full repository at `/workspaces/shannon-manifold` and includes both Node.js and Python. It installs backend and frontend dependencies during container creation, but it does not start either development server automatically.

### Manual run commands

Start the backend:

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Start the frontend in a separate terminal:

```bash
cd frontend
npm run dev -- --host 0.0.0.0
```

The devcontainer forwards ports `8000` and `5173`.

For the full Lean playground experience, run the Docker Compose stack so the separate `lean-server` container is available on port `8080`.

## Docker Compose

1. Review the root `.env` file and adjust secrets or service endpoints as needed.
2. Start the stack:

```bash
docker compose up --build
```

3. Open the frontend at `http://localhost:5173`.
4. Register a new account from the login panel and use that session to access the theorem oracle.

The local stack now includes:
- `frontend` on port `5173`
- `backend` on port `8000`
- `lean-server` on port `8080`
- `mysql` on port `3306`

## Chatbot API

- The frontend chatbot talks to the backend `POST /chat/` endpoint.
- By default, the backend can stay in `mock` mode for local development.
- To switch the chatbot to a real LLM API, configure the root `.env` like this:

```bash
CHATBOT_PROVIDER=openai_compatible
CHATBOT_API_BASE_URL=https://api.openai.com/v1
CHATBOT_API_KEY=your-real-api-key
CHATBOT_MODEL=gpt-4o
CHATBOT_SYSTEM_PROMPT=You are Shannon Manifold Oracle, a precise assistant for proofs, Lean4, Rocq, and theorem debugging.
CHATBOT_TEMPERATURE=0.2
CHATBOT_TIMEOUT_SECONDS=45
CHATBOT_MAX_HISTORY_MESSAGES=12
```

- The backend expects an OpenAI-compatible `POST /chat/completions` API.
- If `CHATBOT_PROVIDER=mock`, the previous deterministic fallback response is used.

Example direct API call:

```bash
curl http://localhost:8000/chat/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-token>" \
  -d '{
    "message": "How do I start proving commutativity of addition in Lean4?",
    "history": [
      { "role": "assistant", "content": "Share the statement you want to prove." }
    ]
  }'
```

## Proof Workspace

- Sign in, then click `Upload Proof` in the header to send a PDF directly into the conversion pipeline.
- You can still move generated Lean drafts into the live playground and continue editing there.
- PDF uploads are processed as `PDF -> Text`, and both Lean4 and Rocq drafts are generated directly from the normalized text.
- The selected Lean4 draft can be pushed directly into the separate `Lean Playground` screen.
- Each workspace keeps the extracted text, generated Lean4 draft, generated Rocq draft, and a multi-agent conversion trace.
- Uploaded PDFs and generated artifacts are stored under the backend paths configured by `PROOF_UPLOAD_DIR` and `PROOF_ARTIFACT_DIR`.

## Lean Playground

- Open the `Lean Playground` tab in the header to get a browser-based Lean editor modeled after `https://live.lean-lang.org/`.
- The playground uses `lean4monaco`, the Lean Infoview, and a Dockerized Lean server bridged over WebSocket.
- The Lean server now runs against the shared repository workspace at `lean-workspace/`, not an isolated demo project inside the container.
- You can upload a local `.lean`, `.txt`, `.v`, or `.rocq` file directly into the playground toolbar.
- Share links include the current Lean buffer in the URL so another browser can reopen the same playground state.
- The frontend connects to the Lean server using `VITE_LEAN_WS_URL`, which defaults to `ws://localhost:8080/` in the local `.env`.
- Set `VITE_GITHUB_REPOSITORY_URL` in the root `.env` if you want the playground to expose a direct repository link.

## Shared Lean Workspace

- The repository now includes a real Lean 4 package under `lean-workspace/`.
- The root package is `ShannonManifold`, and the live playground file is `lean-workspace/ShannonManifold/Playground.lean`.
- Example reusable modules are included under `lean-workspace/ShannonManifold/Library/`.
- Because the `lean-server` container and the backend both mount the same `lean-workspace/` directory, playground code can import repository modules directly, for example:

```lean
import ShannonManifold
import ShannonManifold.Library.Triangle

#check ShannonManifold.pythagoreanStatement
```

- Local verification for the shared Lean project:

```bash
cd lean-workspace
lake build
```

## Lean Workspace API

- `GET /lean-workspace/`
  - returns the active workspace path, the configured playground file, the current repository/branch, and the list of importable Lean modules discovered under `lean-workspace/`
- `POST /lean-workspace/sync-playground`
  - saves the current playground buffer into `LEAN_PLAYGROUND_FILE` inside the shared Lean workspace
- `POST /lean-workspace/push-playground`
  - saves the current playground buffer locally and then pushes `LEAN_REPOSITORY_SUBDIR/<playground file>` to the configured GitHub repository through the GitHub Contents API

The sync and push endpoints require authentication.

## GitHub Sync From The Playground

- Configure the repository and branch in the root `.env`:

```bash
GITHUB_REPOSITORY_URL=https://github.com/owner/repository
GITHUB_REPOSITORY_BRANCH=main
LEAN_REPOSITORY_SUBDIR=lean-workspace
```

- To enable the in-app `Push to GitHub` action, also set:

```bash
GITHUB_ACCESS_TOKEN=your-github-token
GITHUB_COMMIT_AUTHOR_NAME=Shannon Manifold Bot
GITHUB_COMMIT_AUTHOR_EMAIL=bot@shannon-manifold.local
```

- `GITHUB_ACCESS_TOKEN` must have permission to write contents to the target repository branch.
- The playground pushes only the configured playground file by default. Additional importable modules should live under `lean-workspace/` in the repository.

## AWS Migration Notes

- The backend accepts either `DATABASE_URL` or the individual `MYSQL_*` variables, so you can move from the local MySQL container to Amazon RDS without changing application code.
- Replace `JWT_SECRET_KEY`, `MYSQL_*`, `CHATBOT_API_KEY`, `VITE_API_BASE_URL`, `VITE_LEAN_WS_URL`, and `VITE_GITHUB_REPOSITORY_URL` through your deployment environment rather than committing environment-specific values.
- The proof workspace storage paths are already environment-driven. For AWS, keep the same API layer and replace local container storage with EFS or an object-storage handoff such as S3 plus a worker.
- The Lean playground is already isolated behind its own container. For AWS, map it to a dedicated WebSocket-capable service or target group rather than bundling it into the API container.
- The current implementation uses `SQLAlchemy` table creation on startup for simplicity. For production on AWS, introduce migrations before evolving the schema further.
