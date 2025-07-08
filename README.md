<h1 align="center">Flash Api</h1>
  
<div align="center"><img src="./public/images/banner.jpg"></div>


# Multi-Session Whatsapp usando Baileys

API completa para gerenciamento de múltiplas sessões WhatsApp usando Baileys.

## Funcionalidades

- ✅ **Multi-sessão**: Gerencie múltiplas instâncias WhatsApp
- ✅ **Autenticação via API Key**: Sistema seguro de autenticação
- ✅ **QR Code**: Conexão via QR Code
- ✅ **Webhooks**: Receba eventos em tempo real
- ✅ **WebSocket**: Conexão em tempo real bidirecional
- ✅ **Mensagens**: Envie texto, imagem, vídeo, áudio, documento, localização e enquetes
- ✅ **Contatos**: Gerencie e verifique contatos
- ✅ **Grupos**: Criação e gerenciamento de grupos
- ✅ **Banco de dados**: Persistência com Mysql 8+
- ✅ **Documentação**: Swagger UI completa e Postman

## Instalação

```bash
# Clone o projeto
git clone https://github.com/clsshbr2/FlashApi.git
cd FlashApi

# Renomeia o .env de exemplo
cp .env.exemplo .env

> **Atenção:** Antes de iniciar, é necessário configurar o arquivo `.env` com as variáveis de ambiente apropriadas para o funcionamento da aplicação.

# Instala as dependências
npm install

# Gera o banco de dados (arquivo JS que verifica e executa o SQL)
npm run migrate_mysql

# Inicia com pm2
npm install pm2 -g
pm2 start npm --name flashapi -- start

# Inicia sem pm2
npm start

```

## Configuração

### 1. Criar API Key

Primeiro, crie uma API Key para autenticação:

```bash
curl -X POST http://localhost:3000/api/session/create_sessao \
  -H "Content-Type: application/json" \
  -H "apikey: sua-api-key" \
  -d '{
    "nome_sessao": "minha-sessao",
    "numero": "5521999999999",
    "criar_sessao": true,
    "gerar_qrcode": true
  }'
```

### 2. Usar a API Key

Inclua a API Key no header de todas as requisições:

```
X-API-Key: sua-api-key-aqui
```

## Uso Básico

### 1. Criar Sessão

```bash
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sua-api-key" \
  -d '{
    "sessionId": "minha-sessao",
    "webhookUrl": "https://seu-webhook.com/webhook"
  }'
```

### 2. Obter QR Code

```bash
curl -X GET http://localhost:3000/api/session/qr/minha-sessao \
  -H "X-API-Key: sua-api-key"
```

### 3. Enviar Mensagem
## 🔄 Enviar Mensagem

Requisição POST para:  
`http://localhost:3000/api/chat/send-text`

### Body (JSON)
```json
{
  "to": "5599999999999",
  "text": "Olá, tudo bem?"
}

## WebSocket

### Conectar ao WebSocket

```javascript
const ws = new WebSocket('ws://localhost:3000');

// Autenticar
ws.send(JSON.stringify({
  type: 'auth',
  apiKey: 'sua-api-key'
}));

// Inscrever-se nos eventos de uma sessão
ws.send(JSON.stringify({
  type: 'subscribe',
  sessionId: 'minha-sessao'
}));

// Escutar eventos
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Evento recebido:', data);
};
```

## Webhooks

Configure uma URL de webhook ao criar a sessão para receber eventos:

### Eventos Disponíveis

- `qr_updated`: Novo QR Code gerado
- `session_connected`: Sessão conectada com sucesso
- `session_disconnected`: Sessão desconectada
- `message_received`: Nova mensagem recebida
- `presence_update`: Atualização de presença
- `chats_update`: Atualização de chats
- `contacts_update`: Atualização de contatos
- `groups_update`: Atualização de grupos

### Formato do Webhook

```json
{
  "event": "message_received",
  "sessionId": "minha-sessao",
  "data": {
    "id": "message-id",
    "from": "5511999999999@s.whatsapp.net",
    "timestamp": 1640995200,
    "type": "conversation",
    "content": "Texto da mensagem"
  }
}
```

## Endpoints Principais

### Autenticação
- `POST /api/auth/create-key` - Criar API Key
- `GET /api/auth/keys` - Listar API Keys
- `PATCH /api/auth/deactivate-key/:id` - Desativar API Key

### Sessões
- `POST /api/session/create` - Criar sessão
- `GET /api/session/qr/:sessionId` - Obter QR Code
- `GET /api/session/status/:sessionId` - Status da sessão
- `GET /api/session/list` - Listar sessões
- `DELETE /api/session/delete/:sessionId` - Deletar sessão

### Chat
- `POST /api/chat/send-text` - Enviar texto
- `POST /api/chat/send-image` - Enviar imagem
- `POST /api/chat/send-video` - Enviar vídeo
- `POST /api/chat/send-audio` - Enviar áudio
- `POST /api/chat/send-document` - Enviar documento
- `POST /api/chat/send-location` - Enviar localização

### Contatos
- `GET /api/contact/list` - Listar contatos
- `GET /api/contact/profile` - Perfil do contato
- `POST /api/contact/check` - Verificar números

### Grupos
- `GET /api/group/list` - Listar grupos
- `GET /api/group/info` - Info do grupo
- `POST /api/group/create` - Criar grupo
- `POST /api/group/add-participant` - Adicionar participante
- `POST /api/group/remove-participant` - Remover participante
- `POST /api/group/leave` - Sair do grupo

## Documentação

Acesse a documentação completa em: http://localhost:3000/api-docs

## Estrutura do Projeto

```
baileys-multi-session-api/
├── src/
│   ├── config/          # Configurações (database, swagger)
│   ├── controllers/     # Lógica de negócio
│   ├── middleware/      # Middlewares (auth, etc)
│   ├── models/          # Modelos de dados
│   ├── routes/          # Definição das rotas
│   ├── services/        # Serviços (Baileys, Webhook, WebSocket)
│   └── utils/           # Utilitários (logger, etc)
├── sessions/            # Dados das sessões (criado automaticamente)
├── database.sqlite      # Banco de dados SQLite
├── package.json
├── server.js           # Arquivo principal
└── README.md
```

## Tecnologias

- **Node.js** - Runtime JavaScript
- **Express** - Framework web
- **Baileys** - Biblioteca WhatsApp Web
- **SQLite** - Banco de dados leve
- **WebSocket** - Comunicação em tempo real
- **Swagger** - Documentação da API
- **Pino** - Logger estruturado

## Segurança

- Autenticação via API Key
- Rate limiting
- Helmet para headers de segurança
- Validação de dados
- Logs estruturados

## Suporte

Para dúvidas ou problemas:
1. Verifique a documentação Swagger
2. Consulte os logs do servidor
3. Verifique a conectividade da sessão
4. Confirme se a API Key está ativa

## Licença

MIT License
