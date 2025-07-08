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

  ---

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
 const res = response.data;

  if(res.success){
      console.log('✅ Sessão criada com sucesso!');
      console.log('Name Sessão: ' res.dados.name)
      console.log('Apikey: ' res.dados.apikey)
      console.log('Qrcode: ' res.dados.qrcode)
      console.log('Dados: ', res.dados)

  }else{
         console.log('❌ Error ao criar Sessão!');
  }
})
.catch(error => {
  console.error('❌ Erro ao criar sessão:');
  console.error(error.response?.data || error.message);
});

```

  ---

### 🔐 Recuperar QR Code

📌 Importante:
Se gerar_qrcode for false na criação ou a sessão já existir, utilize o endpoint abaixo para reconectar e gerar o QR Code novamente:

```javascript
const axios = require('axios');

const data = {};

axios.put('http://localhost:3000/api/session/conectar_sessao', data, {
  headers: {
    'apikey': 'sua-api-key'
  }
})
.then(response => {
 const res = response.data;
  if(res.success){
      console.log('✅ Qrcode gerado com sucesso!');
      console.log('Qrcode: ' res.qrcode)

  }else{
    console.log('⚠️ Sessão já conectada ou QR Code não necessário.');
  }
})
.catch(error => {
  console.error('❌ Erro ao Gerar qrcode:');
  console.error(error.response?.data || error.message);
});

```

  ---

### 🔐 Reniciar sessão

```javascript
const axios = require('axios');

axios.put('http://localhost:3000/api/session/restart', {
  headers: {
    'apikey': 'sua-api-key'
  }
})
.then(response => {
 const res = response.data;

  if(res.success){
      console.log('✅ Sessão reniciada com sucesso');

  }else{
    console.log('⚠️ Algo deu errado');
  }
})
.catch(error => {
  console.error('❌ Erro ao reniciar sessão:');
  console.error(error.response?.data || error.message);
});
```

  ---

### 🔍 Verificar Status da Sessão

```javascript
const axios = require('axios');

axios.get('http://localhost:3000/api/session/status', {
  headers: {
    'apikey': 'sua-api-key'
  }
})
.then(response => {
 const res = response.data;

  if(res.success){
    console.log('Status sessão: ', res);
  }else{
    console.log('⚠️ Sessão Deve ta conectada');
  }
})
.catch(error => {
  console.error('❌ Erro ao Reniciar sessão:');
  console.error(error.response?.data || error.message);
});
```

  ---

### 🔄 Enviar Mensagem

```javascript
const axios = require('axios');
const data = {
  "to": "5599999999999",
  "text": "Olá! 😄 Tudo bem? 🚀",
  "linkPreview": false,
  "mentions": [
    "string"
  ],
  "delay": 1200,
  "useQueue": false
}
axios.post('http://localhost:3000/api/chat/send-text', data, {
  headers: {
    'Content-Type': 'application/json',
    'apikey': 'sua-api-key'
  }
})
.then(response => {
 const res = response.data;

  if(res.success){
    console.log('Mensagem enviada dados: ', res);
  }else{
    console.log('⚠️ Erro ao enviar mensagem');
  }
})
.catch(error => {
  console.error('❌ Erro ao enviar mensagem:');
  console.error(error.response?.data || error.message);
});
```

  ---

### 🌐 WebSocket
```javascript
/**
 * Autenticação de segurança para o WebSocket da Flash API.
 * O cliente deve autenticar em até 1 minuto (ou o tempo definido em AUTH_TIMEOUT no .env) enviando uma mensagem { type: "auth", secret: string, modo: string }.
 * A não autenticação dentro do prazo resulta na desconexão automática do WebSocket.
 */

const WebSocket = require('ws');
require('dotenv').config();

const Websocket = 'ws://localhost:3000'
const modo = 'client' // global/client
const secret = 'e857f4a4-0ec1-4343-9faf-25c4187a5674' //GLOBAL_WEBSOCKET_SECRET ou apikey da instacia

/*
 * Define o secret para autenticação WebSocket com base no modo:
 * - 'global': Usa o GLOBAL_WEBSOCKET_SECRET do arquivo .env.
 * - 'client': Usa a apiKey da instância do cliente.
 */

function connectWebSocket() {
    const ws = new WebSocket(Websocket);


    ws.onopen = () => {
        console.log('Conectado ao WebSocket');

        // Implementar autenticação segura via WebSocket
        ws.send(JSON.stringify({
            type: 'auth',
            secret,
            modo,
            events: [
                "presence_update",
                "qr_updated",
                "session_disconnected",
                "session_connected",
                "message_received",
                "message_update",
                "presence_update"
            ]
        }));


        // Inicia o intervalo de ping
        setInterval(() => {
            ws.send(JSON.stringify({
                type: 'ping'
            }));
        }, 60000);
    };

    ws.onmessage = (event) => {

        const data = JSON.parse(event.data)
        if (data.type) {
            switch (data.type) {

                //evento de error
                case "error":
                    console.log('Mensagem de erro do websocket: ')
                    console.log(data.message)
                    break;

                //Boas vindas do websocket
                case "welcome":
                    console.log('Você está conectado no websocket da Flash Api:')
                    console.log('   Mensagem: ', data.message)
                    console.log('   Cliente ID: ', data.clientId)
                    break;

                //Autenticação com o websocket com sucesso
                case "auth_success":
                    console.log(`${data.message}: `)
                    console.log('   Cliente ID: ', data.clientId)
                    console.log('   Eventos: ', data.events)
                    break;

                //Verificação de ping
                case "pong":
                    console.log('Verificação de conexão')
                    console.log('   timestamp: ', data.timestamp)
                    console.log('   Cliente ID: ', data.clientId)
                    break;

                //Verificação de ping
                case "event":
                    if(data.event == 'message_received'){
                        console.log('mensagem recebida: ', data)
                    }
                   break;
            }
        }

        
    }

    ws.onclose = (event) => {
        console.log(`Conexão fechada. Código: ${event.code}, Motivo: ${event.reason}`);
    }

}
connectWebSocket();
```

---

### 📡 Webhooks

---

Você pode configurar uma **URL de Webhook** ao criar uma sessão para receber notificações automáticas em tempo real sobre eventos do sistema. Isso permite que você integre e reaja a atividades importantes de forma dinâmica e eficiente! ⚙️📲

---

### 📥 Eventos Disponíveis

---

| Evento                  | Descrição                              | Emoji |
|-------------------------|------------------------------------------|:-----:|
| `presence_update`       | Atualização de presença (ex: online)     | 🟢    |
| `qr_updated`            | Novo QR Code gerado                     | 📷    |
| `session_disconnected`  | Sessão foi desconectada                 | ❌    |
| `session_connected`     | Sessão conectada com sucesso            | ✅    |
| `message_received`      | Nova mensagem recebida                  | 📩    |
| `message_update`        | Mensagem foi editada ou atualizada      | ✏️    |

> 🔔 **Dica:** Os eventos são enviados como **POST** com payload em formato JSON. Certifique-se de que seu endpoint esteja acessível e pronto para lidar com essas requisições!

---

### 📦 Formato do Webhook

---

Os webhooks são enviados como requisições **POST** com conteúdo em **JSON**, contendo os dados do evento que ocorreu.

#### 🧾 Exemplo de Payload:

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
---

## 🚀 Endpoints Principais

---

### 🔐 Sessões

| Método | Endpoint                              | Descrição                              |
|--------|----------------------------------------|----------------------------------------|
| POST   | `/api/session/create_sessao`           | Criar nova sessão                      |
| PUT    | `/api/session/conectar_sessao`         | Conectar uma sessão existente          |
| PUT    | `/api/session/restart`                 | Reiniciar uma sessão conectada         |
| GET    | `/api/session/status/`                 | Verificar status da sessão             |
| GET    | `/api/session/list`                    | Listar todas as sessões                |
| POST   | `/api/session/reconnect`               | Forçar reconexão da sessão             |
| DELETE | `/api/session/delete/{sessionId}`      | Deletar uma sessão                     |

---

### 💬 Chat

| Método | Endpoint                         | Descrição           |
|--------|----------------------------------|---------------------|
| POST   | `/api/chat/send-text`           | Enviar mensagem de texto    |
| POST   | `/api/chat/send-image`          | Enviar imagem       |
| POST   | `/api/chat/send-video`          | Enviar vídeo        |
| POST   | `/api/chat/send-audio`          | Enviar áudio        |
| POST   | `/api/chat/send-document`       | Enviar documento    |
| POST   | `/api/chat/send-location`       | Enviar localização  |
| POST   | `/api/chat/send-poll`           | Enviar enquete      |

---

### 📇 Contatos

| Método | Endpoint                    | Descrição              |
|--------|-----------------------------|------------------------|
| GET    | `/api/contact/list`         | Listar contatos        |
| GET    | `/api/contact/profile`      | Obter perfil do contato|
| POST   | `/api/contact/check`        | Verificar número       |

---

### 👥 Grupos

| Método | Endpoint                            | Descrição                 |
|--------|-------------------------------------|---------------------------|
| GET    | `/api/group/list`                   | Listar grupos             |
| GET    | `/api/group/info`                   | Obter informações do grupo|
| POST   | `/api/group/create`                 | Criar novo grupo          |
| POST   | `/api/group/add-participant`        | Adicionar participante    |
| POST   | `/api/group/remove-participant`     | Remover participante      |
| POST   | `/api/group/leave`                  | Sair do grupo             |

---

## 📚 Documentação

Acesse a documentação interativa via Swagger:

🔗 [`http://localhost:3000/api-docs`](http://localhost:3000/api-docs)

---

## Tecnologias

- **Node.js** - Runtime JavaScript
- **Express** - Framework web
- **Baileys** - Biblioteca WhatsApp Web
- **MYSQL** - Banco de dados
- **WebSocket** - Comunicação em tempo real
- **Swagger** - Documentação da API
- **Postman** - Documentação da API
- **Pino** - Logger estruturado

---

## Segurança

- Autenticação via API Key
- Rate limiting
- Helmet para headers de segurança
- Validação de dados
- Logs estruturados

---

## Suporte

Para dúvidas ou problemas:
1. Verifique a documentação Swagger
2. Consulte os logs do servidor
3. Verifique a conectividade da sessão
4. Confirme se a API Key está ativa

---

## ☕ Apoie este Projeto

Este projeto é **open source** e feito com 💚 para a comunidade.

Se ele te ajudou de alguma forma, considere fazer uma contribuição voluntária.  
Assim você me ajuda a continuar mantendo e evoluindo este trabalho!

<p align="center">
  <img src="https://img.shields.io/badge/Chave%20PIX-ba189cff--4540--49cb--a087--5a60231e9e77-9647FF?style=for-the-badge&logo=pix&logoColor=white" alt="PIX">
</p>

<p align="center">
  📲 <strong>Chave PIX Aleatória:</strong><br>
  <code>ba189cff-4540-49cb-a087-5a60231e9e77</code>
</p>

---

Obrigado por apoiar o software livre! 🚀  
Siga-me para mais projetos incríveis!

---
