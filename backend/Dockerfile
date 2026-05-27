# StudyBuddy Q backend image — Python API + the Node artifact compiler.
#
# POST /api/v1/export shells out to the Node compiler (compiler/dist/cli.js), so
# the runtime needs Node plus the built compiler and its production deps.
# Diagram rendering (--mermaid / headless Chromium) is NOT included; the default
# export path uses the lightweight diagram placeholder.
#
# Build from the REPO ROOT (the context the COPY paths assume):
#   docker build -f backend/Dockerfile -t studybuddyq-backend .

# ── Stage 1: build the Node compiler (TypeScript → dist, prod deps only) ──────
FROM node:20-bookworm-slim AS compiler-build
WORKDIR /build/compiler

# Install all deps (incl. typescript) against the lockfile, then build.
COPY compiler/package.json compiler/package-lock.json ./
RUN npm ci
COPY compiler/tsconfig.json compiler/tsconfig.build.json ./
COPY compiler/src ./src
RUN npm run build \
    # Drop devDependencies (typescript, jest, …); keep only runtime deps
    # (jszip, marked, katex, marked-katex-extension) for the final image.
    && npm prune --omit=dev

# ── Stage 2: Python runtime + Node binary + built compiler ────────────────────
FROM python:3.11-slim
WORKDIR /app

# Node runtime so the backend can spawn the compiler. Both bases are Debian
# bookworm, so the node binary is ABI-compatible; we only need `node` (not npm)
# at runtime. The version check fails the build early if the copy is broken.
COPY --from=node:20-bookworm-slim /usr/local/bin/node /usr/local/bin/node
RUN node --version

# Python deps
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Backend source + vendored pipeline
COPY backend/ /app/backend/
COPY pipeline/ /app/pipeline/

# Built compiler at the path backend.config.compiler_cli defaults to:
# <repo_root>/compiler/dist/cli.js → /app/compiler/dist/cli.js here.
COPY --from=compiler-build /build/compiler/dist /app/compiler/dist
COPY --from=compiler-build /build/compiler/node_modules /app/compiler/node_modules
COPY --from=compiler-build /build/compiler/package.json /app/compiler/package.json

# Fail the build if the compiler can't load at the final image paths. Loading
# the compiled module by absolute path transitively requires its runtime deps
# (jszip / marked / katex / marked-katex-extension) from /app/compiler/node_modules
# — the same resolution the backend gets when it runs `node compiler/dist/cli.js`.
RUN node -e "require('/app/compiler/dist/epub.js'); console.log('compiler runtime OK')"

WORKDIR /app
EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
