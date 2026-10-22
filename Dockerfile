# 브롤스타즈 온라인 서버 (Cloud Run): 외부 패키지 없이 Node.js만 사용
FROM node:22-slim
WORKDIR /app
COPY server/ ./server/
COPY index.html ./index.html
ENV NODE_ENV=production
CMD ["node", "server/server.js"]
