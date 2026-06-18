FROM node:22-alpine

WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store-complement-stub,target=/pnpm/store \
	pnpm config set store-dir /pnpm/store && \
	NPM_CONFIG_USER_AGENT=pnpm/11.7.0 pnpm install --prod --frozen-lockfile
COPY server.js ./

EXPOSE 8080

CMD ["pnpm", "start"]