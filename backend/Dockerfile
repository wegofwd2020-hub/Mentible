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

# Add the heavy, optional render tools — PINNED for reproducible builds. Kept out
# of the committed package.json (CI stays light); installed only into the image.
#
# Puppeteer (Mermaid diagrams + cover raster) downloads its OWN matched Chromium
# into a cache dir we copy into the final image, so puppeteer and its browser can
# never drift apart. An UNPINNED puppeteer pointed at the system Chromium was
# exactly the break that took down `Publish to Library`: `npm install puppeteer`
# silently pulled a version whose Chromium the apt `chromium` couldn't satisfy, so
# the browser failed to launch the instant a diagram render started. Vivliostyle
# (PDF) still uses the system Chromium via SBQ_CHROMIUM, so it needs no browser.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PUPPETEER_CACHE_DIR=/build/compiler/.puppeteer
RUN npm install --no-save puppeteer@25.3.0 mermaid@11.16.0 @vivliostyle/cli@11.0.4

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
# Puppeteer uses the matched Chromium it downloaded in stage 1 (copied below) via
# PUPPETEER_CACHE_DIR — deliberately NOT the system Chromium, so a puppeteer bump
# can't outrun its browser. SBQ_NO_SANDBOX still forces --no-sandbox (Chromium
# can't sandbox in this container). Vivliostyle keeps using the system Chromium
# wrapper via SBQ_CHROMIUM.
ENV PUPPETEER_CACHE_DIR=/app/compiler/.puppeteer \
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
# Puppeteer's matched Chromium (downloaded in stage 1). PUPPETEER_CACHE_DIR points here.
COPY --from=compiler-build /build/compiler/.puppeteer /app/compiler/.puppeteer

# Fail the build if the compiler can't load at the final image paths.
RUN node -e "require('/app/compiler/dist/epub.js'); require('/app/compiler/dist/pdfRender.js'); console.log('compiler runtime OK')"
# Fail the build if Puppeteer's Chromium can't actually LAUNCH here — `require`
# alone never catches a puppeteer↔Chromium mismatch or a missing shared lib, which
# is precisely how the `Publish to Library` break shipped undetected. This turns a
# silent runtime failure at publish time into a loud build failure.
RUN node -e "const p=require('/app/compiler/node_modules/puppeteer'); p.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']}).then(async b=>{const v=await b.version();await b.close();console.log('puppeteer chromium launch OK:',v)}).catch(e=>{console.error('CHROMIUM LAUNCH FAILED:',e.message);process.exit(1)})"

WORKDIR /app
EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
