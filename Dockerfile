# Usa a imagem base oficial do Node
FROM node:latest

# Cria o diretório de trabalho
WORKDIR /app

# Copia os arquivos para o container
COPY package*.json ./

# Remover node_modules
RUN rm -rf node_modules

# Instala dependências
RUN npm install

# Copia o restante do código
COPY . .

# Expõe a porta
EXPOSE 3000

# Comando para iniciar o app
CMD ["npm", "start"]
