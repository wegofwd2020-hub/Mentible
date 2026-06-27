# StudyBuddy Q backend image — Python API + the Node artifact compiler, with a
# headless Chromium for PDF (Vivliostyle) and diagram (Mermaid → SVG) rendering.
#
# POST /api/v1/export shells out to the Node compiler (compiler/dist/cli.js).
# format=epub|pdf and diagrams=true are all supported here.
#
# Build from the REPO ROOT (the context the COPY paths assume):
#   docker build -f backend/Dockerfile -t studybuddyq-backend .

# ── Stage 1: build the Node compiler + install the optional render tools ──────
FROM node:20-bookworm-slim AS compiler-build
WORKDIR /build/compiler

COPY compiler/package.json compiler/package-lock.json ./
RUN npm ci
COPY compiler/tsconfig.json compiler/tsconfig.build.json ./
COPY compiler/src ./src
# Build, then drop devDeps (typescript, jest, …) keeping runtime deps.
RUN npm run build && npm prune --omit=dev

# Add the heavy, optional render tools WITHOUT their bundled browsers — the
# final image ships a system Chromium both are pointed at. Kept out of the
# committed package.json (CI stays light); installed only into the image.
# puppeteer + mermaid drive the batched one-browser diagram renderer; vivliostyle
# renders the PDF.
ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --no-save puppeteer mermaid @vivliostyle/cli

# ── Stage 2: Python runtime + Node + Chromium + built compiler ────────────────
FROM python:3.11-slim
WORKDIR /app

# Node runtime (only `node`, not npm) — ABI-compatible bookworm→bookworm.
COPY --from=node:20-bookworm-slim /usr/local/bin/node /usr/local/bin/node
RUN node --version

# Headless Chromium + fonts for Vivliostyle (PDF) and Mermaid (diagrams).
# git is required by pip to clone the wegofwd-llm git+https dependency (ADR-012).
# poppler-utils provides `pdfinfo` for export-time page-geometry compliance
# checks (A1/A2, SBQ-TRUST-002); if it were ever absent those checks fail closed
# rather than crash (see export/pdf_meta.py).
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      chromium fonts-liberation fonts-noto fonts-noto-color-emoji \
      poppler-utils \
      libnss3 libatk-bridge2.0-0 libgbm1 libasound2 libxkbcommon0 \
      libxdamage1 libxcomposite1 libxrandr2 libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

# Chromium wrapper forcing --no-sandbox (Vivliostyle exposes no sandbox flag,
# and Chromium can't sandbox in this container). SBQ_CHROMIUM points Vivliostyle
# here; PUPPETEER_EXECUTABLE_PATH + SBQ_NO_SANDBOX drive Mermaid's Puppeteer.
RUN printf '#!/bin/sh\nexec /usr/bin/chromium --no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage "$@"\n' \
      > /usr/local/bin/chromium-nosandbox && chmod +x /usr/local/bin/chromium-nosandbox
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    SBQ_NO_SANDBOX=1 \
    SBQ_CHROMIUM=/usr/local/bin/chromium-nosandbox

# Python deps
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Backend source + vendored pipeline
COPY backend/ /app/backend/
COPY pipeline/ /app/pipeline/

# Built compiler (dist + node_modules incl. the render CLIs) at the path
# backend.config.compiler_cli defaults to.
COPY --from=compiler-build /build/compiler/dist /app/compiler/dist
COPY --from=compiler-build /build/compiler/node_modules /app/compiler/node_modules
COPY --from=compiler-build /build/compiler/package.json /app/compiler/package.json

# Fail the build if the compiler can't load at the final image paths.
RUN node -e "require('/app/compiler/dist/epub.js'); require('/app/compiler/dist/pdfRender.js'); console.log('compiler runtime OK')"

WORKDIR /app
EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
