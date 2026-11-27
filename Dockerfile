# Usa a imagem base oficial do Node
FROM node:24.14.0

# Cria o diretório de trabalho
WORKDIR /app

# Copia os arquivos para o container
COPY package*.json .npmrc ./

# Remover node_modules
RUN rm -rf node_modules

# Instala dependências
RUN npm install

# Copia o restante do código
COPY . .

# Expõe a porta
EXPOSE 3000

# Comando para iniciar o app
# "exec" faz o node virar o PID 1: recebe o SIGTERM do `docker stop` e desconecta as sessões antes de sair
CMD ["sh", "-c", "node gerardb.js && exec node server.js"]
