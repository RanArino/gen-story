FROM node:24-bookworm-slim
WORKDIR /decoder
RUN npm install --omit=dev --ignore-scripts sharp@0.35.5 heic-decode@2.1.0 file-type@22.0.1
COPY decode-worker.mjs /decoder/decode-worker.mjs
USER node
ENTRYPOINT ["node", "/decoder/decode-worker.mjs"]
