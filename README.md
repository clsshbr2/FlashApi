<h1 align="center">Flash Api</h1>
  
<div align="center"><img src="./public/images/banner.jpg"></div>


# Multi-Session Whatsapp usando Baileys

<p align="center">
  API robusta para gerenciamento de múltiplas sessões do WhatsApp utilizando <b>Baileys</b>.
</p>


---

## ✨ Funcionalidades

- ✅ **Multi-Sessão**: Controle diversas instâncias do WhatsApp simultaneamente  
- ✅ **Autenticação com API Key**: Segurança integrada com chave de acesso  
- ✅ **Conexão via QR Code**: Fácil autenticação de dispositivos  
- ✅ **Webhooks**: Receba notificações em tempo real  
- ✅ **WebSocket**: Comunicação bidirecional em tempo real  
- ✅ **Envio de Mensagens**: Texto, imagem, vídeo, áudio, documento, localização e enquetes  
- ✅ **Gestão de Contatos**: Consulta e gerenciamento de contatos  
- ✅ **Gestão de Grupos**: Criação e administração de grupos  
- ✅ **Persistência com MySQL 8+**: Banco de dados estruturado  
- ✅ **Documentação Swagger e Postman**: Fácil integração com documentação interativa  

---

## ⚙️ Instalação

```bash
# Clone o projeto
git clone https://github.com/clsshbr2/FlashApi.git
cd FlashApi

# Renomeia o .env de exemplo
cp .env.exemplo .env

> ⚠️ **Atenção:** Antes de iniciar, é necessário configurar o arquivo `.env` com as variáveis de ambiente apropriadas para o funcionamento da aplicação.

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

### 🔐 Criar Sessão

### Geração e Recuperação de QR Code na criação da sessão

Se os parâmetros `criar_sessao` e `gerar_qrcode` forem definidos como `true`, o QR Code será gerado automaticamente no formato **Base64** na resposta da requisição, pronto para ser exibido e escaneado.

```javascript
const axios = require('axios');

const data = {
  nome_sessao: 'minha-sessao',
  numero: '5521999999999',
  criar_sessao: true,
  gerar_qrcode: true
};

axios.post('http://localhost:3000/api/session/create_sessao', data, {
  headers: {
    'Content-Type': 'application/json',
    'apikey': 'sua-api-key'
  }
})
.then(response => {

  if(response.success){
      console.log('✅ Sessão criada com sucesso!');
      console.log('Name Sessão: ' response.dados.name)
      console.log('Apikey: ' response.dados.apikey)
      console.log('Qrcode: ' response.dados.qrcode)
      console.log('Dados: ', response.dados)

  }else{
         console.log('❌ Error ao criar Sessão!');
  }
})
.catch(error => {
  console.error('❌ Erro ao criar sessão:');
  console.error(error.response?.data || error.message);
});

```

📌 Importante:
Se gerar_qrcode for false ou a sessão já existir e precisar ser reconectada, utilize o endpoint abaixo para gerar ou recuperar o QR Code novamente:

```javascript
const axios = require('axios');

const data = {};

axios.put('http://localhost:3000/api/session/conectar_sessao', data, {
  headers: {
    'apikey': 'sua-api-key'
  }
})
.then(response => {

  if(response.success){
      console.log('✅ Qrcode gerado com sucesso!');
      console.log('Qrcode: ' response.qrcode)

  }else{
         console.log('❌ Error ao Gerar qrcode!');
  }
})
.catch(error => {
  console.error('❌ Erro ao Gerar qrcode:');
  console.error(error.response?.data || error.message);
});

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
```

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


## Tecnologias

- **Node.js** - Runtime JavaScript
- **Express** - Framework web
- **Baileys** - Biblioteca WhatsApp Web
- **MYSQL** - Banco de dados leve
- **WebSocket** - Comunicação em tempo real
- **Swagger** - Documentação da API
- **Postman** - Documentação da API
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
