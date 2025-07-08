
FROM node

WORKDIR /serverjs

COPY server.js .

EXPOSE 3000

CMD ["node", "server.js"]

