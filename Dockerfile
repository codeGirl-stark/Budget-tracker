# Aucune dépendance à installer : l'image se réduit à Node et au code source.
# Node 22.5+ est requis pour `node:sqlite`.
FROM node:24-alpine

# tini : sans lui, le process Node reçoit mal SIGTERM et la base peut être
# fermée brutalement au redéploiement.
RUN apk add --no-cache tini

WORKDIR /app

# Le code d'abord, les données ensuite : /data est un volume monté par Fly.
COPY package.json ./
COPY shared/ ./shared/
COPY server/ ./server/
COPY client/ ./client/

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    TRUST_PROXY=1

EXPOSE 8080

# L'utilisateur `node` existe déjà dans l'image ; on lui donne le volume.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
