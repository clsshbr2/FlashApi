<div align="center">

<img src="./public/images/banner.png" alt="Flash API Banner" width="100%">

# ⚡ Flash API

### API REST Multi-Sessão para WhatsApp, construída sobre a zapo-js

Gerencie centenas de instâncias do WhatsApp de forma independente, com autenticação por API Key, Webhooks, WebSocket, painel administrativo e persistência em PostgreSQL + Redis.

<br>

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![zapo-js](https://img.shields.io/badge/zapo--js-WhatsApp_Web-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://github.com/vinikjkkj/zapo)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](#-licença)
[![Version](https://img.shields.io/badge/version-1.0.8-blueviolet?style=for-the-badge)](#-novidades-da-versão-108)
[![Apoie com Pix](https://img.shields.io/badge/Apoie_com-Pix-32BCAD?style=for-the-badge&logo=pix&logoColor=white)](#-apoie-o-projeto)

</div>

---

## 📚 Sumário

- [Sobre o Projeto](#-sobre-o-projeto)
- [Novidades da versão 1.0.8](#-novidades-da-versão-108)
- [Principais Recursos](#-principais-recursos)
- [Arquitetura](#-arquitetura)
- [Fluxo de Funcionamento](#-fluxo-de-funcionamento)
- [Estrutura de Pastas](#-estrutura-de-pastas)
- [Tecnologias e Dependências](#-tecnologias-e-dependências)
- [Pré-requisitos](#-pré-requisitos)
- [Instalação](#-instalação)
  - [Instalação Manual](#instalação-manual)
  - [Instalação com Docker](#instalação-com-docker)
- [Variáveis de Ambiente](#-variáveis-de-ambiente)
- [Scripts Disponíveis](#-scripts-disponíveis)
- [Como Executar](#-como-executar)
- [Painel Administrativo (Manager)](#-painel-administrativo-manager)
- [Referência da API](#-referência-da-api)
  - [Autenticação](#autenticação)
  - [Sessões](#sessões)
  - [Mensagens (Chat)](#mensagens-chat)
  - [Contatos](#contatos)
  - [Grupos](#grupos)
  - [Perfil](#perfil)
  - [Privacidade](#privacidade)
  - [Chamadas de Voz](#chamadas-de-voz)
  - [Configurações](#configurações)
  - [Sistema](#sistema)
- [Exemplos de Uso](#-exemplos-de-uso)
- [Webhooks](#-webhooks)
- [WebSocket](#-websocket)
- [Coleção Postman](#-coleção-postman)
- [Limitações Conhecidas](#-limitações-conhecidas)
- [Roadmap](#-roadmap)
- [FAQ](#-faq)
- [Contribuindo](#-contribuindo)
- [Apoie o Projeto](#-apoie-o-projeto)
- [Licença](#-licença)

---

## 🧭 Sobre o Projeto

**Flash API** é uma API RESTful escrita em **Node.js (ESM)** que expõe o protocolo do WhatsApp Web através da biblioteca [**zapo-js**](https://github.com/vinikjkkj/zapo), permitindo criar e administrar **múltiplas sessões (instâncias) de WhatsApp** simultaneamente através de uma **API Key** exclusiva por sessão.

> 📘 Detalhes da integração com o WhatsApp (arquitetura, banco, eventos e manutenção) em [`docs/WHATSAPP_ZAPO.md`](docs/WHATSAPP_ZAPO.md).

O projeto foi pensado para cenários de **multi-tenant/multi-atendimento**, oferecendo:

- Criação de sessões via QR Code ou pareamento por número de telefone;
- Persistência automática pela **zapo** em **PostgreSQL**: credenciais, chaves, mensagens, chats e contatos (a API não grava nada manualmente);
- Cache de sessões e do painel com **Redis**;
- Notificações em tempo real via **Webhook HTTP** e/ou **WebSocket**;
- Um **painel web (Manager)** para acompanhar e administrar as sessões visualmente.

> ⚠️ Este projeto não é afiliado, endossado ou de qualquer forma oficialmente conectado ao WhatsApp Inc./Meta. Use com responsabilidade e em conformidade com os Termos de Serviço do WhatsApp.

---

## 🆕 Novidades da versão 1.0.8

| Área                     | O que mudou                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🚀 **Estabilidade**      | zapo-js **1.12.2**. Sessões não desistem de reconectar: após 10 tentativas rápidas, tentam a cada 5 min e avisam pelo `connection_update`.                         |
| 🔔 **Webhooks**          | Eventos que falham em todas as tentativas vão para uma **fila no Redis** e são reenviados depois (1, 2, 4… até 30 min). Nada se perde com o seu servidor fora do ar. |
| 👥 **Grupos**            | Entrar por link de convite, prévia do convite, aprovar/recusar pedidos de entrada, mensagens temporárias, quem pode adicionar membros e **comunidades**.             |
| 🙋 **Perfil**            | Nome, recado e foto da conta (qualquer imagem, convertida automaticamente), foto de grupos, **@username** e perfil comercial.                                       |
| 🔒 **Privacidade**       | Visto por último, online, foto, recado, confirmação de leitura, grupos, ligações, listas de exceção e contatos bloqueados.                                        |
| 📞 **Chamadas de voz**   | Ligar e **tocar um áudio** quando atenderem, e **chamadas ao vivo pelo painel** com o microfone do navegador. Opcional (`ENABLE_CALLS=true`).                       |
| 🧪 **Testador**          | Página estilo Postman no painel (`/manager/api-tester`) com **todas** as rotas, gerada a partir da coleção Postman.                                                |
| 🛠️ **Suporte**           | `POST /api/contact/resync-session` refaz a criptografia com um contato e corrige o **"Aguardando mensagem"**.                                                      |
| 💬 **Chat / atendimento** | Conversas da mais recente para a mais antiga, com prévia, nome e foto; download de **qualquer** mídia como arquivo (com reenvio de mídia expirada); editar mensagem; histórico de mensagens corrigido (o conteúdo voltava vazio). |
| 🧹 **Limpeza**           | Dependências sem uso removidas e todos os `console.log` trocados pelo logger.                                                                                     |

> ⚠️ **Mudança de comportamento:** `GET /api/contact/list` agora traz **só quem tem conversa com a conta** (antes vinham milhares de membros de grupos). Para a lista completa, use `?filter=todos`. Veja [Contatos](#contatos).

---

## ✨ Principais Recursos

| Recurso                                    | Descrição                                                                                                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔀 **Multi-Sessão**                        | Crie e opere múltiplas instâncias do WhatsApp de forma isolada, cada uma com sua própria `apikey`.                                                                                                             |
| 🔑 **Autenticação em 2 níveis**            | `GLOBAL_API_KEY` para operações administrativas (criar/listar/remover sessões) e `apikey` por sessão para operações de mensageria.                                                                             |
| 📱 **Conexão via QR Code ou Pairing Code** | Suporte a conexão tradicional por QR Code ou por número de telefone.                                                                                                                                           |
| 💬 **Envio completo de mensagens**         | Texto, imagem, vídeo, áudio (convertido para Opus/OGG automaticamente via `ffmpeg`), documento, localização, contato, figurinha (sticker), reação, enquete, listas, botões, mensagens interativas e carrossel. |
| 👥 **Gestão de Grupos**                    | Criar, listar, atualizar participantes/descrição/assunto, permissões, links de convite, entrar por convite, pedidos de entrada, mensagens temporárias e comunidades.                                            |
| 👤 **Gestão de Contatos**                  | Listagem com filtro (conversas, agenda ou todos), busca e paginação; verificação de números, bloqueio, LID → JID e reparo da criptografia ("Aguardando mensagem").                                              |
| 🙋 **Perfil e Privacidade**                | Nome, recado, foto, @username e perfil comercial da conta; todas as opções de privacidade do WhatsApp e listas de exceção.                                                                                     |
| 📞 **Chamadas de voz** _(opcional)_         | Ligar e tocar um áudio gravado, ou falar ao vivo pelo painel com o microfone do navegador.                                                                                                                     |
| 🔔 **Webhooks configuráveis**              | Webhook global (via `.env`) ou por sessão, com lista de eventos customizável, tentativas de reenvio e **fila no Redis** para eventos que falharem.                                                              |
| 🔌 **WebSocket nativo**                    | Canal bidirecional (`/ws`) para consumo de eventos em tempo real sem long-polling.                                                                                                                             |
| 🗄️ **Persistência pela zapo**              | A zapo guarda sozinha credenciais, chaves, mensagens, chats e contatos no PostgreSQL (tabelas `zapo_*`); a API só consulta. O Redis guarda o estado das sessões, o cache e a sessão do painel.                 |
| 🖥️ **Painel Web (Manager)**                | Dashboard EJS com login de administrador/usuário para operar sessões, **testador de endpoints** estilo Postman com todas as rotas e **painel de chamadas** ao vivo.                                            |
| 🌍 **Suporte a Proxy**                     | Roteamento de conexões por proxy HTTP/HTTPS/SOCKS4/SOCKS5 por sessão.                                                                                                                                          |
| 🧹 **Auto-limpeza de sessões**             | Remoção automática de sessões desconectadas após um tempo configurável.                                                                                                                                        |
| 🐳 **Docker-ready**                        | `Dockerfile` e `docker-compose.yml` prontos, orquestrando API + PostgreSQL + Redis.                                                                                                                            |
| 📬 **Coleção Postman**                     | `postman_collection.json` incluso, pronto para importar e testar todos os endpoints.                                                                                                                           |

---

## 🏗️ Arquitetura

A Flash API segue uma arquitetura em camadas (routes → services → models → banco de dados), com a **zapo** persistindo tudo da conta no PostgreSQL e o Redis atuando como camada de cache/sessão.

```mermaid
flowchart TB
    Client["Cliente / Integração<br/>(App, CRM, Chatbot)"] -->|HTTP + Header apikey| API[Express API]

    subgraph FlashAPI["Flash API (Node.js)"]
        API --> MW["Middlewares<br/>auth.js / globalAuth.js / helmet / cors"]
        MW --> Routes["Rotas<br/>session · chat · contact · group · profile · privacy · call · config · system"]
        Routes --> Services["Services<br/>WhatsAppService · messageService · buttonsService"]
        Services --> Zapo["zapo-js<br/>(conexão WhatsApp Web)"]
        Services --> WSService["WebSocketService"]
        Manager["Manager Web (EJS)<br/>/manager/*"] --> Routes
    end

    Services <-->|estado das sessões, cache| Redis[(Redis)]
    Services <-->|dados das sessões, proxies| Postgres[(PostgreSQL)]
    Zapo <-->|credenciais, chaves, mensagens, chats, contatos| Postgres

    WSService -->|eventos em tempo real| WSClients["Clientes WebSocket<br/>/ws"]
    Manager -->|áudio das chamadas ao vivo| WSCall["WebSocket /ws/call"]
    Services -->|POST evento| Webhook["Webhook externo<br/>(HTTP callback)"]
    Zapo <-->|Protocolo WhatsApp Web| WhatsApp(["WhatsApp"])
```

---

## 🔄 Fluxo de Funcionamento

Fluxo típico de criação e uso de uma sessão:

```mermaid
sequenceDiagram
    participant U as Usuário/Integração
    participant A as Flash API
    participant B as WhatsApp Service
    participant W as WhatsApp

    U->>A: POST /api/session/create_sessao (GLOBAL_API_KEY)
    A-->>U: 200 OK (apikey da nova sessão)

    U->>A: PUT /api/session/conectar_sessao (apikey)
    A->>B: createSession(apikey)
    B->>W: Solicita QR Code / Pairing Code
    W-->>B: Envia QR Code
    B-->>A: QR Code gerado
    A-->>U: 200 OK (QR Code / status)

    U->>W: Escaneia o QR Code no app do WhatsApp
    W-->>B: connection.update (open)
    B->>A: Sessão conectada (status: connected)
    A-->>U: Webhook/WebSocket: connection_update

    U->>A: POST /api/chat/send-text (apikey da sessão)
    A->>B: sendMessage()
    B->>W: Envia mensagem via protocolo WhatsApp Web
    W-->>U: Mensagem entregue ao destinatário
```

---

## 🗂️ Estrutura de Pastas

```text
FlashApi/
├── Dockerfile                  # Imagem Docker da API
├── docker-compose.yml          # Orquestração: API + PostgreSQL + Redis
├── gerardb.js                  # Inicializa/valida o banco de dados na subida do servidor
├── nodemon.json                # Configuração do hot-reload em desenvolvimento
├── package.json                # Dependências e scripts npm
├── postman_collection.json     # Coleção Postman com todos os endpoints
├── server.js                   # Ponto de entrada da aplicação (Express + WebSocket)
│
├── public/                     # Arquivos estáticos servidos pela API
│   ├── css/                    # Estilos do painel Manager
│   ├── images/                 # Imagens (banner, avatar padrão etc.)
│   └── js/                     # Scripts do painel (api-tester.js, call.js, call-audio-worklet.js…)
│
├── views/                      # Views EJS do painel administrativo (Manager)
│   ├── index.ejs               # Login
│   ├── user.ejs                # Painel do cliente
│   ├── dashboard.ejs           # Painel do administrador
│   ├── api-tester.ejs          # Testador de endpoints (estilo Postman)
│   └── call.ejs                # Chamadas ao vivo pelo navegador
│
├── supabase/
│   └── migrations/
│       └── postgres.sql        # Schema SQL de referência das tabelas
│
└── src/
    ├── config/
    │   ├── env.js               # Carrega e normaliza todas as variáveis de ambiente
    │   ├── database.js          # Conexão/execução de queries no banco
    │   └── verificardb.js       # Verificação/atualização incremental de colunas/tabelas
    │
    ├── middleware/
    │   ├── auth.js               # Autenticação por apikey de sessão
    │   └── globalAuth.js         # Autenticação por GLOBAL_API_KEY (rotas administrativas)
    │
    ├── models/
    │   ├── ApiKey.js
    │   └── Session.js              # Sessões, configuração, proxy e importação de credenciais
    │
    ├── routes/
    │   ├── session.js            # Ciclo de vida das sessões (criar, conectar, status, deletar…)
    │   ├── chat.js                # Envio de mensagens e leitura de conversas
    │   ├── contact.js             # Contatos: listar, checar, bloquear, reparar criptografia
    │   ├── group.js               # Grupos: criar, administrar, convites, pedidos, comunidades
    │   ├── profile.js             # Perfil da conta: nome, recado, foto, @username, comercial
    │   ├── privacy.js             # Privacidade e contatos bloqueados
    │   ├── call.js                # Chamadas de voz com áudio gravado
    │   ├── rotaSessao.js          # Esqueleto comum das rotas (sessão conectada + erros)
    │   ├── config.js              # Configurações da sessão (webhook, proxy, dados gerais)
    │   ├── system.js              # Status/monitoramento do sistema
    │   └── manager.js             # Login, dashboard, testador e painel de chamadas
    │
    ├── services/
    │   ├── WhatsAppService.js      # Gerencia as sessões (criar, reconectar, proxy, desligar)
    │   ├── WebSocketService.js     # Broadcast de eventos via WebSocket (/ws)
    │   ├── WebhookService.js       # Envio de webhooks + fila de reenvio no Redis
    │   ├── ChamadaAoVivoService.js # WebSocket /ws/call: áudio das chamadas ao vivo do painel
    │   ├── messageService.js       # Montagem/envio de mensagens (mídia, texto, localização…)
    │   ├── buttonsService.js       # Botões, listas, mensagens interativas e carrossel
    │   ├── redis.js                # Cliente Redis (ioredis)
    │   └── EventService.js         # Liga os eventos da sessão a webhooks e WebSocket (+ conexão e rejeição de chamadas)
    │
    ├── whatsapp/                   # Camada de integração com a zapo-js
    │   ├── SessaoWhatsApp.js       # Uma conexão: envio, grupos, contatos, mídia, presença
    │   ├── conteudo.js             # Corpo da requisição -> conteúdo da zapo
    │   ├── eventos.js              # Eventos da zapo -> eventos publicados pela API
    │   ├── store.js                # Store PostgreSQL da zapo + consultas (mensagens, chats, contatos)
    │   ├── chamadas.js             # Plugin de chamadas (@zapo-js/voip): áudio gravado e ao vivo
    │   ├── importarCredenciais.js  # Importa a sessão enviada pela extensão do navegador
    │   └── utils.js                # JIDs, base64, mídia por URL e adaptador do logger
    │
    └── utils/
        ├── logger.js               # Logger (pino) com formatação amigável
        └── prepareMedia.js         # Normalização de mídia (URL, base64, buffer)
```

---

## 🧰 Tecnologias e Dependências

### Core

| Tecnologia                                                           | Uso                                           |
| -------------------------------------------------------------------- | --------------------------------------------- |
| [Node.js 20+](https://nodejs.org/)                                   | Runtime JavaScript (ESM — `"type": "module"`) |
| [Express 4](https://expressjs.com/)                                  | Framework HTTP/REST                           |
| [zapo-js](https://github.com/vinikjkkj/zapo) | Cliente WhatsApp Web (multi-device)           |
| [ws](https://github.com/websockets/ws)                               | Servidor WebSocket nativo                     |
| [EJS](https://ejs.co/)                                               | Template engine do painel Manager             |
| [PostgreSQL](https://www.postgresql.org/) (`pg`)                     | Banco de dados relacional principal           |
| [Redis](https://redis.io/) (`ioredis`)                               | Cache, sessões e filas                        |

### Bibliotecas de apoio

| Categoria           | Pacotes                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Segurança           | `helmet`, `cors`, `bcrypt`, `express-session`, `connect-redis`                                    |
| Validação           | `joi`                                                                                             |
| Mídia               | `@ffmpeg-installer/ffmpeg`, `fluent-ffmpeg`*, `wa-sticker-formatter`, `qrcode`                    |
| Chamadas de voz     | `@zapo-js/voip`, `@roamhq/wrtc`, `libmlow-wasm-fork` (carregados só com `ENABLE_CALLS=true`)      |
| HTTP/Proxy          | `axios`, `https-proxy-agent`, `undici`                                                            |
| Documentação        | `swagger-jsdoc`, `swagger-ui-express`                                                             |
| Utilitários         | `uuid`, `moment-timezone`, `p-limit`, `systeminformation`, `pino`, `pino-pretty`                  |
| Dev                 | `nodemon`, `prettier`, `prettier-plugin-ejs`                                                      |

<sub>* `fluent-ffmpeg` é utilizado no código-fonte para conversão de áudio para Opus/OGG — recomenda-se adicioná-lo explicitamente ao `package.json` caso não esteja listado na sua versão local.</sub>

---

## ✅ Pré-requisitos

| Componente              | Versão mínima             |
| ----------------------- | ------------------------- |
| Node.js                 | 20+                       |
| npm                     | 9+                        |
| PostgreSQL              | 16+                       |
| Redis                   | 7+                        |
| Docker + Docker Compose | _(opcional, recomendado)_ |

---

## 📦 Instalação

### Instalação Manual

```bash
# 1. Clone o repositório
git clone https://github.com/clsshbr2/FlashApi.git
cd FlashApi

# 2. Instale as dependências
npm install

# 3. Copie e configure o arquivo de ambiente
cp .env.example .env
# edite o .env com seus dados de banco, redis, api key etc.

# 4. Rode a migração/verificação inicial do banco (opcional — também roda no start)
npm run migrate

# 5. Suba o servidor
npm start        # produção
# ou
npm run dev       # desenvolvimento (hot-reload com nodemon)
```

A API ficará disponível em `http://localhost:3000` (ou na `PORT` configurada).

### Instalação com Docker

O projeto já inclui um `docker-compose.yml` que sobe **API + PostgreSQL + Redis** de uma só vez:

```bash
git clone https://github.com/clsshbr2/FlashApi.git
cd FlashApi

docker compose up -d
```

> O `docker-compose.yml` já traz variáveis de ambiente padrão para desenvolvimento/teste. **Altere as senhas, `GLOBAL_API_KEY` e `SENHA_MANAGER_ADMIN` antes de usar em produção.**

Caso queira construir a imagem localmente ao invés de usar `flashconect/flash-api:v1.0.6`:

```bash
docker build -t flash-api:local .
docker run -d \
  --name flash-api \
  -p 3000:3000 \
  --env-file .env \
  flash-api:local
```

---

## ⚙️ Variáveis de Ambiente

Todas as variáveis abaixo devem ser definidas em um arquivo `.env` na raiz do projeto (veja `.env.example`).

### Geral

| Variável            | Padrão              | Descrição                                                                          |
| ------------------- | ------------------- | ---------------------------------------------------------------------------------- |
| `HOST`              | `localhost:3000`    | Host/URL onde a API é servida                                                      |
| `PROTOCOLO`         | `http`              | Protocolo utilizado (`http` \| `https`)                                            |
| `PORT`              | `3000`              | Porta da API                                                                       |
| `LOG_LEVEL`         | `info`              | Nível de log da aplicação (`fatal`,`error`,`warn`,`info`,`debug`,`trace`,`silent`) |
| `WA_LOG_LEVEL`      | `LOG_LEVEL`         | Nível de log da zapo (aceita também o antigo `BAILEYS_LOG_LEVEL`)                  |
| `VERSAO`            | `1.0.4`             | Versão exibida pela API                                                            |
| `SYNC_SESSIONS`     | `true`              | Pede o histórico completo ao conectar (a zapo guarda mensagens, chats e contatos)  |
| `AUTO_INICIAR_SESSOES` | `true`           | Reconecta todas as sessões salvas ao subir a API. **Use `false` em máquinas de teste que apontam para o banco de produção**, senão as sessões brigam com a instância no ar |
| `TZ`                | `America/Sao_Paulo` | Timezone da aplicação                                                              |
| `NODE_ENV`          | `development`       | Ambiente de execução (`development` \| `production`)                               |

### CORS

| Variável       | Padrão | Descrição                                                    |
| -------------- | ------ | ------------------------------------------------------------ |
| `CORS_ORIGINS` | `*`    | Origens permitidas, separadas por vírgula, ou `*` para todas |

### Painel Administrativo (Manager)

| Variável              | Padrão   | Descrição                                                     |
| --------------------- | -------- | ------------------------------------------------------------- |
| `MANAGER`             | `false`  | Habilita/desabilita o painel web em `/manager`                |
| `LOGIN_MANAGER_ADMIN` | —        | Usuário administrador do painel                               |
| `LOGIN_MANAGER_USER`  | —        | Usuário comum do painel                                       |
| `SENHA_MANAGER_ADMIN` | `123456` | Senha do administrador (também usada como _secret_ da sessão) |

### Sessão WhatsApp (padrão)

| Variável               | Padrão      | Descrição                                                                    |
| ---------------------- | ----------- | ---------------------------------------------------------------------------- |
| `SESSION_PHONE_CLIENT` | `Flash_api` | Nome do "dispositivo" exibido no WhatsApp                                    |
| `SESSION_PHONE_NAME`   | `Chrome`    | Nome do "navegador" exibido (`Chrome`, `Firefox`, `Edge`, `Opera`, `Safari`) |

### API Key Global

| Variável         | Padrão               | Descrição                                                                                            |
| ---------------- | -------------------- | ---------------------------------------------------------------------------------------------------- |
| `GLOBAL_API_KEY` | _(chave de exemplo)_ | Chave obrigatória para rotas administrativas (criar/listar/remover sessões). **Troque em produção.** |

### Webhook Global

| Variável                  | Padrão    | Descrição                                          |
| ------------------------- | --------- | -------------------------------------------------- |
| `ENABLE_GLOBAL_WEBHOOK`   | `false`   | Habilita envio de eventos para uma URL fixa global |
| `GLOBAL_WEBHOOK_URL`      | `null`    | URL que receberá os eventos                        |
| `GLOBAL_WEBHOOK_ATTEMPTS` | `4`       | Tentativas de reenvio em caso de falha             |
| `GLOBAL_WEBHOOK_EVENTS`   | _(todos)_ | Lista de eventos enviados, separados por vírgula   |

### Fila de reenvio de webhooks

Vale para o webhook global e para os webhooks das sessões. Quando todas as tentativas imediatas falham (rede, timeout ou HTTP 5xx), o evento vai para uma fila no Redis e é reenviado depois, com espera crescente (1, 2, 4, 8… até 30 min). Respostas 4xx não são repetidas.

| Variável                     | Padrão  | Descrição                                       |
| ---------------------------- | ------- | ----------------------------------------------- |
| `WEBHOOK_QUEUE_ENABLED`      | `true`  | Liga/desliga a fila de reenvio                  |
| `WEBHOOK_QUEUE_MAX_ATTEMPTS` | `12`    | Reenvios pela fila antes de descartar o evento  |
| `WEBHOOK_QUEUE_MAX_SIZE`     | `10000` | Máximo de eventos guardados na fila             |

### WebSocket Global

| Variável                  | Padrão               | Descrição                                      |
| ------------------------- | -------------------- | ---------------------------------------------- |
| `ENABLE_WEBSOCKET`        | `false`              | Habilita o broadcast global via WebSocket      |
| `GLOBAL_WEBSOCKET_SECRET` | _(chave de exemplo)_ | Chave usada para autenticar clientes WebSocket |

### Chamadas de Voz

| Variável                         | Padrão  | Descrição                                                                                 |
| -------------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `ENABLE_CALLS`                   | `false` | Habilita as chamadas (`/api/call` e o painel `/manager/call`). Reinicie a API ao mudar    |
| `CALL_RING_TIMEOUT_SECONDS`      | `45`    | Tempo esperando o contato atender antes de desistir                                       |
| `CALL_MAX_DURATION_SECONDS`      | `300`   | Duração máxima de uma chamada com áudio gravado                                           |
| `CALL_LIVE_MAX_DURATION_SECONDS` | `3600`  | Duração máxima de uma chamada ao vivo pelo painel                                         |

> Com `ENABLE_CALLS=true`, as ligações recebidas passam pelo plugin de chamadas. O evento `call` e a rejeição automática continuam funcionando normalmente.

### Banco de Dados

| Variável              | Padrão      | Descrição                                    |
| --------------------- | ----------- | -------------------------------------------- |
| `DB_TYPE`             | `postgres`  | Tipo de banco de dados                       |
| `DB_HOST`             | `localhost` | Host do PostgreSQL                           |
| `DB_PORT`             | `5432`      | Porta do PostgreSQL                          |
| `DB_USER`             | `root`      | Usuário do banco                             |
| `DB_PASSWORD`         | _(vazio)_   | Senha do banco                               |
| `DB_DATABASE`         | `FlashApi`  | Nome do banco de dados                       |
| `DB_CONNECTION_LIMIT` | `10`        | Máximo de conexões simultâneas               |
| `QUEUELIMIT`          | `0`         | Limite da fila de conexões (`0` = ilimitado) |

### Redis

| Variável     | Padrão      | Descrição                 |
| ------------ | ----------- | ------------------------- |
| `REDIS_HOST` | `127.0.0.1` | Host do Redis             |
| `REDIS_PORT` | `6379`      | Porta do Redis            |
| `REDIS_PASS` | _(vazio)_   | Senha do Redis (opcional) |

### QR Code

| Variável        | Padrão | Descrição                                         |
| --------------- | ------ | ------------------------------------------------- |
| `LIMITE_QRCODE` | `10`   | Número máximo de QR Codes gerados simultaneamente |

### Remoção Automática de Sessões

| Variável                 | Padrão  | Descrição                                    |
| ------------------------ | ------- | -------------------------------------------- |
| `DELETE_SESAO_DISCONECT` | `false` | Remove automaticamente sessões desconectadas |
| `TEMP_DELETE_SESSAO`     | `5`     | Tempo (em horas) até a remoção automática    |

### Proxy (por sessão)

| Variável                            | Padrão            | Descrição                                                                      |
| ----------------------------------- | ----------------- | ------------------------------------------------------------------------------ |
| `PROXY_STATE`                       | `false`           | Habilita uso de proxy nas conexões                                             |
| `PROXY_PROTOCOL`                    | `http`            | Protocolo do proxy (`http`, `https`, `socks4`, `socks4a`, `socks5`, `socks5h`) |
| `PROXY_HOST`                        | —                 | Host/IP do proxy                                                               |
| `PROXY_USERNAME`                    | —                 | Usuário do proxy                                                               |
| `PROXY_PASSWORD`                    | —                 | Senha do proxy                                                                 |
| `PROXY_PORT`                        | _(aleatória)_     | Porta fixa do proxy                                                            |
| `PROXY_PORT_MIN` / `PROXY_PORT_MAX` | `10000` / `20000` | Faixa para geração de porta aleatória, caso `PROXY_PORT` não seja definida     |

---

## 📜 Scripts Disponíveis

| Comando           | Descrição                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `npm start`       | Executa `gerardb.js` (verifica/cria o banco) e então inicia `server.js` em modo produção   |
| `npm run dev`     | Inicia o servidor com **nodemon**, reiniciando a cada alteração de arquivo                 |
| `npm run migrate` | Executa apenas `gerardb.js`, útil para inicializar/atualizar o schema do banco manualmente |
| `npm test`        | Placeholder — nenhum teste automatizado configurado ainda                                  |

---

## ▶️ Como Executar

```bash
# Ambiente de desenvolvimento
npm run dev

# Ambiente de produção
npm start
```

Ao subir, a API automaticamente:

1. Verifica a conexão com o PostgreSQL e cria o banco/tabelas caso não existam (`gerardb.js` + `verificardb.js`);
2. Reconecta as sessões salvas (a zapo retoma as credenciais do PostgreSQL, sem novo QR Code);
3. Inicia o servidor HTTP + WebSocket na porta configurada.

```text
🚀 Flash API rodando na porta 3000
✅ Iniciando Flash API - WhatsApp Multi-Session
```

---

## 🖥️ Painel Administrativo (Manager)

Quando `MANAGER=true`, um painel web fica disponível para login e acompanhamento visual das sessões:

| Rota                     | Descrição                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `GET /manager/login`     | Tela de login                                                                                                  |
| `POST /manager/login`    | Autenticação (usuário/senha definidos em `LOGIN_MANAGER_ADMIN` / `LOGIN_MANAGER_USER` / `SENHA_MANAGER_ADMIN`) |
| `GET /manager/dashboard` | Dashboard com status das sessões (requer sessão autenticada)                                                   |
| `GET /manager/api-tester`| Testador de endpoints estilo Postman                                                                           |
| `GET /manager/call`      | Chamadas ao vivo pelo navegador (requer `ENABLE_CALLS=true`)                                                   |
| `GET /manager/logout`    | Encerra a sessão do painel                                                                                     |

A sessão do painel é persistida no **Redis** via `express-session` + `connect-redis`.

### Testar endpoints

A página `/manager/api-tester` lista **todas** as rotas da API, montadas a partir do `postman_collection.json` (rota nova adicionada ao Postman aparece sozinha).

- Busca por nome ou rota; pastas iguais às do Postman; rotas que exigem a apikey global aparecem com 🔒.
- Corpo JSON com botão **Formatar**, aba de parâmetros (`:id_message`…) e envio com **Ctrl+Enter**.
- Resposta com status, tempo, tamanho, JSON formatado (imagens são exibidas) e botões **Copiar** e **cURL**.
- Variáveis: `{{apikey}}` vem da sessão; `{{RemoteJid}}` vem do campo "Número de teste".
- **Cliente** usa a apikey da própria sessão. **Admin** escolhe a sessão e usa a apikey global nas rotas 🔒.
- A coleção é entregue à página **sem** as variáveis do arquivo, para não expor a apikey global.

### Chamadas ao vivo

Com `ENABLE_CALLS=true`, a página `/manager/call` permite ao atendente **ligar** ou **atender** e falar pelo microfone do navegador (com mudo, desligar e aviso de ligação recebida). O áudio trafega pelo WebSocket `/ws/call`, autenticado pelo login do painel.

- O navegador só libera o microfone em **HTTPS** (ou `localhost`).
- Use fone de ouvido para evitar eco.
- Fechar a página encerra a ligação.

---

## 📖 Referência da API

> Base URL padrão: `http://localhost:3000`
> Formato de resposta padrão: `{ "success": boolean, "message": string, "data": object }`

### Autenticação

A Flash API utiliza **dois níveis de chave**, enviados no header HTTP:

| Header                       | Uso                                                                       | Escopo     |
| ---------------------------- | ------------------------------------------------------------------------- | ---------- |
| `apikey: <GLOBAL_API_KEY>`   | Rotas administrativas (criar, listar, remover sessões, status do sistema) | Global     |
| `apikey: <apikey-da-sessão>` | Rotas de mensageria/contatos/grupos de uma sessão específica              | Por sessão |

```http
POST /api/session/create_sessao HTTP/1.1
Host: localhost:3000
Content-Type: application/json
apikey: SEU_GLOBAL_API_KEY
```

> O header `apikey` também aceita `Authorization: Bearer <token>` ou `x-api-key` nas rotas globais.

### Sessões

Rotas em `src/routes/session.js`.

| Método   | Endpoint                         | Auth    | Descrição                                                              |
| -------- | -------------------------------- | ------- | ---------------------------------------------------------------------- |
| `POST`   | `/api/session/create_sessao`     | Global  | Cria uma nova sessão (retorna a `apikey`)                              |
| `PUT`    | `/api/session/conectar_sessao`   | Sessão  | Gera QR Code / inicia conexão (aceita `phoneNumber` para pairing code) |
| `PUT`    | `/api/session/restart`           | Sessão  | Reinicia o socket da sessão                                            |
| `GET`    | `/api/session/status`            | Sessão  | Retorna status atual da sessão                                         |
| `GET`    | `/api/session/list`              | Global  | Lista todas as sessões e estatísticas                                  |
| `GET`    | `/api/session/health`            | Global  | Health check da API                                                    |
| `DELETE` | `/api/session/delete/:sessionId` | Global  | Remove definitivamente uma sessão                                      |
| `DELETE` | `/api/session/desconect`         | Sessão  | Desconecta o WhatsApp da sessão (logout)                               |
| `GET`    | `/api/session/avatar/:apikey`    | Pública | Retorna a foto de perfil do número conectado                           |
| `POST`   | `/api/session/creds`             | Sessão  | Injeta credenciais/keys previamente exportadas                         |

### Mensagens (Chat)

Rotas em `src/routes/chat.js` — todas exigem o header `apikey` da sessão.

| Método   | Endpoint                            | Descrição                                              |
| -------- | ----------------------------------- | ------------------------------------------------------ |
| `POST`   | `/api/chat/send-text`               | Envia mensagem de texto                                |
| `POST`   | `/api/chat/send-image`              | Envia imagem (URL ou base64)                           |
| `POST`   | `/api/chat/send-video`              | Envia vídeo                                            |
| `POST`   | `/api/chat/send-audio`              | Envia áudio (convertido automaticamente para Opus/OGG) |
| `POST`   | `/api/chat/send-document`           | Envia documento/arquivo                                |
| `POST`   | `/api/chat/send-location`           | Envia localização (latitude/longitude)                 |
| `POST`   | `/api/chat/send-contact`            | Envia cartão de contato (vCard)                        |
| `POST`   | `/api/chat/send-sticker`            | Cria e envia figurinha a partir de imagem              |
| `POST`   | `/api/chat/send-reaction`           | Reage a uma mensagem com emoji                         |
| `POST`   | `/api/chat/send-poll`               | Cria uma enquete                                       |
| `POST`   | `/api/chat/send-list`               | Envia lista de opções                                  |
| `POST`   | `/api/chat/send-buttons`            | Envia mensagem com botões                              |
| `POST`   | `/api/chat/send-interactiveMessage` | Envia mensagem interativa                              |
| `POST`   | `/api/chat/send-carouselMessage`    | Envia carrossel de cards                               |
| `POST`   | `/api/chat/typing`                  | Simula "digitando…" / "gravando áudio…"                |
| `POST`   | `/api/chat/mark-read`               | Marca mensagens como lidas                             |
| `GET`    | `/api/chat/messages`                | Lista mensagens de uma conversa (`jid`, `limit`, `before` em ms) |
| `GET`    | `/api/chat/chats`                   | Lista conversas **da mais recente para a mais antiga**, com prévia da última mensagem (ver abaixo) |
| `POST`   | `/api/chat/edit`                    | Edita o texto de uma mensagem enviada (`{ jid, messageId, text }`; até ~15 min após o envio) |
| `DELETE` | `/api/chat/delete/:id_message`      | Apaga uma mensagem                                     |
| `GET`    | `/api/chat/media/:messageId`        | Baixa a mídia de uma mensagem como **arquivo** (imagem, vídeo, áudio, documento, figurinha). `?download=1` força o download |
| `POST`   | `/api/chat/media`                   | Igual, a partir do objeto que chegou no webhook (`{ message, key }`) |
| `POST`   | `/api/chat/midiaToBase64`           | Converte a mídia em base64 (prefira `/chat/media` para arquivos grandes) |

**`GET /api/chat/chats`** — parâmetros opcionais: `page`, `limit` (até 100), `search` (nome, número ou jid), `type` (`todos` · `privados` · `grupos`) e `archived` (`true` · `false`). Cada conversa traz:

```json
{
  "jid": "123456789012345@lid",
  "name": "Maria Souza",
  "phoneNumber": "5511999999999@s.whatsapp.net",
  "isGroup": false,
  "unread_count": 2,
  "archived": false,
  "pinned": null,
  "lastMessage": { "id": "3EB0…", "timestamp": 1764200000, "fromMe": false, "type": "image", "text": "📷 Foto" },
  "avatar": "/api/contact/avatar/APIKEY/123456789012345@lid"
}
```

`lastMessage.type`: `text` · `image` · `video` · `audio` · `document` · `sticker` · `location` · `contact` · `poll` · `reaction` · `deleted` · `other`. Mensagens editadas mostram o texto novo (`edited: true`).

**Mídia recebida:** `/api/chat/media` entrega o arquivo em fluxo (sem carregar tudo na memória), com o tipo e o nome certos. Se a mídia for antiga e já tiver expirado no servidor do WhatsApp, a API pede ao aparelho de origem que a envie de novo, automaticamente; se não for mais possível, responde **410**.

### Contatos

Rotas em `src/routes/contact.js`.

| Método | Endpoint                           | Descrição                                                                 |
| ------ | ---------------------------------- | ------------------------------------------------------------------------- |
| `GET`  | `/api/contact/list`                | Lista contatos da sessão (filtro, busca e paginação — ver abaixo)         |
| `GET`  | `/api/contact/avatar/:apikey/:jid` | Foto de perfil de um contato                                              |
| `POST` | `/api/contact/check`               | Verifica se um número existe no WhatsApp                                  |
| `POST` | `/api/contact/block`               | Bloqueia/desbloqueia um contato                                           |
| `POST` | `/api/contact/lid-to-jid`          | Converte identificador LID em JID                                         |
| `POST` | `/api/contact/resync-session`      | Refaz a criptografia com um contato (`{ jid, mode: "force" \| "identity" }`) — corrige "Aguardando mensagem" |

**Parâmetros de `GET /api/contact/list`** (todos opcionais):

| Parâmetro | Valores                              | Descrição                                                                                       |
| --------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `filter`  | `conversas` (padrão) · `agenda` · `todos` | Só quem tem conversa · só salvos na agenda do celular · tudo o que a zapo guardou (inclui membros de grupos) |
| `search`  | texto                                | Busca por nome, número ou @username                                                              |
| `page` / `limit` | `page=1&limit=100`            | Paginação (`limit` de 1 a 1000). Sem `page`, devolve tudo; com `page`, a resposta traz `pages`    |

### Grupos

Rotas em `src/routes/group.js`.

| Método | Endpoint                                    | Descrição                                                        |
| ------ | ------------------------------------------- | ---------------------------------------------------------------- |
| `GET`  | `/api/group/list`                           | Lista grupos da sessão                                           |
| `POST` | `/api/group/info`                           | Detalhes de um grupo                                             |
| `POST` | `/api/group/create`                         | Cria um novo grupo                                               |
| `POST` | `/api/group/update-description`             | Atualiza a descrição do grupo                                    |
| `POST` | `/api/group/ParticipantsUpdate`             | Adiciona/remove/promove/rebaixa participantes                    |
| `POST` | `/api/group/leave`                          | Sai de um grupo                                                  |
| `POST` | `/api/group/update-subject`                 | Atualiza o nome do grupo                                         |
| `POST` | `/api/group/up-setting`                     | Atualiza configurações (quem pode enviar mensagens/editar dados) |
| `GET`  | `/api/group/group-Invite/:groupJid`         | Gera link de convite                                             |
| `GET`  | `/api/group/group-Invite-revogar/:groupJid` | Revoga o link de convite atual                                   |
| `POST` | `/api/group/invite-info`                    | Prévia de um convite sem entrar (`{ link }` ou `{ code }`)       |
| `POST` | `/api/group/join`                           | Entra pelo convite; `status` = `joined` ou `pending` (aguardando aprovação) |
| `POST` | `/api/group/requests`                       | Lista pedidos de entrada pendentes (`{ groupJid }`)              |
| `POST` | `/api/group/requests-update`                | Aprova ou recusa pedidos (`{ groupJid, participants, action: "approve" \| "reject" }`) |
| `POST` | `/api/group/ephemeral`                      | Mensagens temporárias (`expiration`: `0`, `86400`, `604800`, `7776000`) |
| `POST` | `/api/group/member-add-mode`                | Quem adiciona membros (`mode`: `admin_add` \| `all_member_add`)  |
| `POST` | `/api/group/community/create`               | Cria uma comunidade                                              |
| `POST` | `/api/group/community/subgroups`            | Lista os grupos de uma comunidade                                |
| `POST` | `/api/group/community/link`                 | Vincula/desvincula grupos (`action`: `link` \| `unlink`)         |
| `POST` | `/api/group/community/deactivate`           | Desativa uma comunidade                                          |

### Perfil

Rotas em `src/routes/profile.js` — header `apikey` da sessão.

| Método   | Endpoint                          | Descrição                                                                                     |
| -------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET`    | `/api/profile/me`                 | Dados da conta: id, nome, recado, foto e @username                                            |
| `PUT`    | `/api/profile/name`               | Nome exibido (`{ name }`, até 25 caracteres)                                                  |
| `PUT`    | `/api/profile/status`             | Recado (`{ status }`, até 139 caracteres)                                                     |
| `PUT`    | `/api/profile/picture`            | Foto da conta, ou do grupo com `groupJid` (`{ image }`: URL, data URI ou base64; convertida para JPEG quadrado) |
| `DELETE` | `/api/profile/picture`            | Remove a foto da conta (ou do grupo com `groupJid`)                                           |
| `POST`   | `/api/profile/contact-status`     | Recado de um contato (`{ jid }`)                                                              |
| `GET`    | `/api/profile/username`           | @username da conta                                                                            |
| `POST`   | `/api/profile/username/check`     | Verifica se um @username está livre (com sugestões)                                           |
| `PUT`    | `/api/profile/username`           | Define o @username (409 com sugestões se indisponível)                                        |
| `DELETE` | `/api/profile/username`           | Remove o @username                                                                            |
| `POST`   | `/api/profile/username/resolve`   | Descobre a conta de um @username                                                              |
| `POST`   | `/api/profile/business`           | Perfil comercial de um contato (sem `jid`, o da própria conta)                                |
| `PUT`    | `/api/profile/business`           | Edita o perfil comercial (somente WhatsApp Business)                                          |

### Privacidade

Rotas em `src/routes/privacy.js` — header `apikey` da sessão.

| Método | Endpoint                             | Descrição                                                                                         |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/privacy`                       | Configurações atuais e os valores aceitos por cada uma                                            |
| `PUT`  | `/api/privacy`                       | Altera uma ou várias: `{ "lastSeen": "contacts", "online": "match_last_seen", "readReceipts": "none" }` |
| `GET`  | `/api/privacy/disallowed/:setting`   | Lista de exceção de uma categoria ("meus contatos, exceto...")                                    |
| `PUT`  | `/api/privacy/disallowed`            | Altera a lista de exceção (`{ setting, add: [...], remove: [...] }`)                              |
| `GET`  | `/api/privacy/blocklist`             | Contatos bloqueados                                                                               |

Configurações disponíveis: `readReceipts`, `lastSeen`, `online`, `profilePicture`, `about`, `groupAdd`, `callAdd`, `messages`, `defenseMode`, `linkedProfiles`, `pix`.

### Chamadas de Voz

Rotas em `src/routes/call.js` — header `apikey` da sessão. Requer `ENABLE_CALLS=true`.

| Método | Endpoint              | Descrição                                                                 |
| ------ | --------------------- | ------------------------------------------------------------------------- |
| `POST` | `/api/call/start`     | Liga e toca um áudio quando o contato atender                             |
| `POST` | `/api/call/end`       | Encerra uma chamada (`{ callId }`)                                        |
| `GET`  | `/api/call/list`      | Chamadas acompanhadas pela sessão                                         |
| `GET`  | `/api/call/:callId`   | Status de uma chamada                                                     |

Corpo de `POST /api/call/start`:

```json
{
  "jid": "5511999999999",
  "audio": "https://seusite.com/audios/aviso.mp3",
  "ringTimeoutSeconds": 45,
  "hangupAfterAudio": true
}
```

- `audio` aceita **URL** (link direto para o arquivo), **data URI** ou **base64** — mp3, ogg/opus, wav, m4a. O áudio é validado e convertido **antes** de ligar.
- Com `hangupAfterAudio: true`, a ligação cai ~1,5 s após o fim do áudio. Ninguém atendeu em `ringTimeoutSeconds`? A chamada é cancelada.
- Uma chamada por vez por sessão (a segunda recebe **409**). Somente áudio (sem vídeo) e somente 1:1.
- O andamento chega pelo evento **`call_update`** (`state`, `endReason`, `durationSecs`, `audioFinished`).

> Para falar **ao vivo**, use o painel [`/manager/call`](#chamadas-ao-vivo).

### Configurações

Rotas em `src/routes/config.js`.

| Método | Endpoint              | Descrição                                                                             |
| ------ | --------------------- | ------------------------------------------------------------------------------------- |
| `GET`  | `/api/config/session` | Retorna as configurações da sessão                                                    |
| `PUT`  | `/api/config/config`  | Atualiza configurações gerais (leitura automática, rejeitar ligações, ignorar grupos) |
| `PUT`  | `/api/config/webhook` | Atualiza URL/status do webhook da sessão                                              |
| `PUT`  | `/api/config/proxy`   | Atualiza configuração de proxy da sessão                                              |

### Sistema

Rotas em `src/routes/system.js` (autenticação **global**).

| Método | Endpoint             | Descrição                                                            |
| ------ | -------------------- | -------------------------------------------------------------------- |
| `GET`  | `/api/system/status` | Métricas de sistema (CPU, memória, uptime — via `systeminformation`) |
| `GET`  | `/api/system/config` | Configurações globais atuais da API                                  |

---

## 💡 Exemplos de Uso

### Criar uma sessão

```bash
curl -X POST http://localhost:3000/api/session/create_sessao \
  -H "Content-Type: application/json" \
  -H "apikey: SEU_GLOBAL_API_KEY" \
  -d '{
        "nome_sessao": "atendimento_vendas",
        "leitura_automatica": false,
        "rejeitar_ligacoes": true,
        "ignorar_grupos": true,
        "events": ["message_received", "connection_update"]
      }'
```

### Conectar (gerar QR Code)

```bash
curl -X PUT http://localhost:3000/api/session/conectar_sessao \
  -H "Content-Type: application/json" \
  -H "apikey: APIKEY_DA_SESSAO"
```

### Enviar mensagem de texto

```bash
curl -X POST http://localhost:3000/api/chat/send-text \
  -H "Content-Type: application/json" \
  -H "apikey: APIKEY_DA_SESSAO" \
  -d '{
        "jid": "5511999999999",
        "text": "Olá! Esta é uma mensagem enviada pela Flash API 🚀"
      }'
```

### Enviar imagem por URL

```bash
curl -X POST http://localhost:3000/api/chat/send-image \
  -H "Content-Type: application/json" \
  -H "apikey: APIKEY_DA_SESSAO" \
  -d '{
        "jid": "5511999999999",
        "image": "https://exemplo.com/imagem.jpg",
        "caption": "Confira nossa novidade!"
      }'
```

### Listar só os contatos com conversa (paginado)

```bash
curl "http://localhost:3000/api/contact/list?filter=conversas&page=1&limit=100" \
  -H "apikey: APIKEY_DA_SESSAO"
```

### Ligar e tocar um áudio

```bash
curl -X POST http://localhost:3000/api/call/start \
  -H "Content-Type: application/json" \
  -H "apikey: APIKEY_DA_SESSAO" \
  -d '{
        "jid": "5511999999999",
        "audio": "https://seusite.com/audios/aviso.mp3"
      }'
```

### Exemplo em Node.js (axios)

```javascript
import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:3000/api",
  headers: { apikey: "APIKEY_DA_SESSAO" },
});

async function enviarMensagem() {
  const { data } = await api.post("/chat/send-text", {
    jid: "5511999999999",
    text: "Mensagem enviada via Node.js 🎉",
  });

  console.log(data);
}

enviarMensagem();
```

### Exemplo em Python (requests)

```python
import requests

url = "http://localhost:3000/api/chat/send-text"
headers = {"apikey": "APIKEY_DA_SESSAO"}
payload = {
    "jid": "5511999999999",
    "text": "Mensagem enviada via Python 🐍"
}

response = requests.post(url, json=payload, headers=headers)
print(response.json())
```

---

## 🔔 Webhooks

Cada sessão pode ter seu próprio webhook (configurado via `PUT /api/config/webhook`), ou você pode habilitar um **webhook global** que recebe eventos de todas as sessões (`ENABLE_GLOBAL_WEBHOOK=true` + `GLOBAL_WEBHOOK_URL`).

Formato do payload recebido:

```json
{
  "success": true,
  "message": "Webhook recebido com sucesso!",
  "received": {
    "event": "messages_upsert",
    "apikey": "83725a47-fc7a-404a-bbac-206d590bae8f",
    "data": { "...": "..." }
  },
  "timestamp": "2026-07-05T12:00:00.000Z"
}
```

Principais eventos disponíveis (configuráveis via `GLOBAL_WEBHOOK_EVENTS` ou por sessão em `events`):

`connection_update` · `qr_updated` · `creds_update` · `messages_upsert` · `messages_update` · `messages_delete` · `messages_reaction` · `message_receipt_update` · `chats_upsert` · `chats_update` · `chats_delete` · `contacts_upsert` · `contacts_update` · `groups_upsert` · `groups_update` · `group_participants_update` · `presence_update` · `call` · `call_update` · `labels_edit` · `blocklist_update` · entre outros.

**Eventos novos ou ampliados na 1.0.8:**

- `call_update`: andamento das chamadas de voz (`callId`, `peerJid`, `direction`, `state`, `endReason`, `durationSecs`, `audioFinished`).
- `connection_update` com o campo `reconnect`: enviado quando a sessão passa a tentar reconectar a cada 5 minutos.

```json
{ "connection": "close", "reconnect": { "mode": "slow", "attempts": 10, "nextAttemptInMs": 300000, "nextAttemptAt": "…", "reason": "…" } }
```

**Entrega garantida:** se o seu endpoint estiver fora do ar ou responder 5xx, o evento fica na fila do Redis e é reenviado depois (veja [Fila de reenvio de webhooks](#fila-de-reenvio-de-webhooks)).

---

## 🔌 WebSocket

Além de webhooks, é possível consumir os mesmos eventos em tempo real via WebSocket:

```javascript
const ws = new WebSocket("ws://localhost:3000/ws", [], {
  headers: {
    apikey: proccess.env.APIKEY,
    events: JSON.stringify([
      "connection_update",
      "creds_update",
      "messaging_history_set",
      "messaging_history_status",

      "chats_upsert",
      "chats_update",
      "chats_delete",
      "chats_lock",

      "lid_mapping_update",
      "presence_update",

      "contacts_upsert",
      "contacts_update",

      "messages_upsert",
      "messages_update",
      "messages_delete",
      "messages_media_update",
      "messages_reaction",
      "message_receipt_update",
      "message_capping_update",

      "groups_upsert",
      "groups_update",
      "group_participants_update",
      "group_join_request",
      "group_member_tag_update",

      "blocklist_set",
      "blocklist_update",

      "call",
      "call_update",

      "labels_edit",
      "labels_association",

      "newsletter_reaction",
      "newsletter_view",
      "newsletter_participants_update",
      "newsletter_settings_update",

      "settings_update",
    ]),
  },
});

ws.onopen = () => {
  console.log("Conectado ao WebSocket da Flash API");
};

ws.onmessage = (event) => {
  const payload = JSON.parse(event.data);
  console.log("Evento recebido:", payload);
};
```

Habilite com `ENABLE_WEBSOCKET=true` e proteja o canal com `GLOBAL_WEBSOCKET_SECRET`.

> O WebSocket `/ws/call` é outro canal, usado só pelo painel de chamadas ao vivo (áudio), e é autenticado pelo login do painel.

---

## 📬 Coleção Postman

O repositório inclui `postman_collection.json` com todos os endpoints documentados e prontos para uso. Basta importar no Postman/Insomnia e configurar as variáveis: `baseUrl` (ex.: `http://localhost:3000/api`), `apikey` (sessão), `apikeyGlobal` e `RemoteJid` (número de teste).

> A mesma coleção alimenta o [testador de endpoints](#testar-endpoints) do painel. Ao criar uma rota, adicione-a na coleção e ela aparece nos dois lugares.
>
> ⚠️ Não publique a coleção com valores reais nas variáveis (principalmente `apikeyGlobal`).

---

## ⚠️ Limitações Conhecidas

- 🔸 Depende diretamente da engenharia reversa do protocolo WhatsApp Web feita pela **zapo-js** — mudanças no WhatsApp podem exigir atualização da dependência.
- 🔸 Não é uma solução oficial/homologada pela Meta; o uso em desacordo com os Termos de Serviço do WhatsApp pode resultar em banimento do número.
- 🔸 Conversão de áudio depende de `ffmpeg` (via `@ffmpeg-installer/ffmpeg`), o que pode aumentar o tempo de build da imagem Docker.
- 🔸 Não há suíte de testes automatizados configurada (`npm test` é um placeholder).
- 🔸 A geração de QR Code é limitada por sessão (`LIMITE_QRCODE`) para evitar rate-limit do WhatsApp.
- 🔸 O painel Manager utiliza sessão simples com usuário/senha em variáveis de ambiente — recomenda-se reforçar a segurança (proxy reverso com HTTPS, IP allowlist) antes de expor publicamente.
- 🔸 **Chamadas:** somente áudio (sem vídeo), 1:1 e uma chamada por vez por sessão. O painel de chamadas ao vivo exige HTTPS para liberar o microfone.
- 🔸 As chamadas usam o módulo nativo `@roamhq/wrtc` (Linux x64 com glibc, como a imagem `node` oficial). Imagens Alpine/ARM podem exigir build próprio.

---

## 🗺️ Roadmap

> Sugestão de evolução com base na estrutura atual do projeto. Contribuições e PRs para itens abaixo são bem-vindas!

- [ ] Documentação Swagger totalmente publicada em `/docs` (dependências já presentes no projeto)
- [ ] Suíte de testes automatizados (unitários e de integração)
- [ ] Suporte oficial a MySQL (variável `DB_TYPE` já prevê a opção)
- [ ] Métricas exportáveis em formato Prometheus
- [ ] Rate limiting configurável por sessão
- [ ] Multi-idioma no painel Manager
- [ ] Publicação de imagem Docker multiarch (amd64/arm64) no Docker Hub

---

## ❓ FAQ

<details>
<summary><b>Preciso pagar para usar a API oficial do WhatsApp?</b></summary>
<br>
Não. A Flash API utiliza a <b>zapo-js</b>, que se conecta via WhatsApp Web (multi-device), sem custos oficiais do WhatsApp Business API. Ainda assim, o uso é por sua conta e risco quanto aos Termos de Serviço do WhatsApp.
</details>

<details>
<summary><b>Quantas sessões posso criar simultaneamente?</b></summary>
<br>
Não há um limite fixo imposto pelo código além do <code>LIMITE_QRCODE</code> (limite de QR Codes simultâneos). A capacidade real depende dos recursos de CPU/RAM do servidor e da estabilidade da conexão com o WhatsApp.
</details>

<details>
<summary><b>A API funciona sem PostgreSQL ou Redis?</b></summary>
<br>
Não. Ambos são obrigatórios: o PostgreSQL guarda as sessões da API e tudo o que a zapo persiste (credenciais, chaves, mensagens, chats e contatos); o Redis guarda o estado das sessões, o cache e a sessão do painel Manager.
</details>

<details>
<summary><b>Como eu recebo mensagens que chegam no WhatsApp?</b></summary>
<br>
Configure um <b>Webhook</b> (global ou por sessão) para receber os eventos via HTTP POST, ou conecte-se ao endpoint <code>/ws</code> para recebê-los via WebSocket em tempo real.
</details>

<details>
<summary><b>Posso usar um número de WhatsApp Business?</b></summary>
<br>
Sim, a zapo-js suporta contas padrão e Business. O comportamento pode variar conforme recursos exclusivos do WhatsApp Business (catálogo, mensagens automáticas nativas etc.).
</details>

<details>
<summary><b>Por que a lista de contatos veio menor depois de atualizar?</b></summary>
<br>
A partir da 1.0.8, <code>GET /api/contact/list</code> traz só quem tem conversa com a conta. A zapo guarda todo contato que "vê" (inclusive membros de todos os grupos), por isso antes vinham milhares de pessoas. Para o comportamento antigo, use <code>?filter=todos</code>; para os salvos no celular, <code>?filter=agenda</code>.
</details>

<details>
<summary><b>Um contato aparece como "Aguardando mensagem". Como resolver?</b></summary>
<br>
Chame <code>POST /api/contact/resync-session</code> com <code>{ "jid": "5511999999999" }</code>. Se o contato trocou de celular ou reinstalou o WhatsApp, use <code>"mode": "identity"</code>. As próximas mensagens usam a sessão de criptografia nova.
</details>

<details>
<summary><b>O que coloco no campo <code>audio</code> da chamada?</b></summary>
<br>
Um link direto para o arquivo (mp3, ogg, wav, m4a), um data URI ou o arquivo em base64. Uma dica: tudo o que está na pasta <code>public/</code> é servido pela API, então <code>public/audios/aviso.mp3</code> fica disponível em <code>http://SEU-SERVIDOR:3000/audios/aviso.mp3</code>.
</details>

<details>
<summary><b>Como troco a senha padrão do painel Manager?</b></summary>
<br>
Altere as variáveis <code>LOGIN_MANAGER_ADMIN</code>, <code>LOGIN_MANAGER_USER</code> e <code>SENHA_MANAGER_ADMIN</code> no arquivo <code>.env</code> (ou no <code>docker-compose.yml</code>) antes de subir o serviço em produção.
</details>

---

## 🤝 Contribuindo

Contribuições são muito bem-vindas! Para colaborar:

1. Faça um **fork** do projeto
2. Crie uma branch para sua feature/correção: `git checkout -b feature/minha-feature`
3. Faça commit das suas alterações: `git commit -m "feat: adiciona minha feature"`
4. Envie para o seu fork: `git push origin feature/minha-feature`
5. Abra um **Pull Request** descrevendo as mudanças

**Boas práticas ao contribuir:**

- Siga o estilo de código já utilizado no projeto (formatação com `prettier`, disponível via `devDependencies`).
- Sempre que possível, atualize a documentação (`README.md`, `.env.example`, coleção Postman) junto das mudanças de código.
- Descreva claramente o problema resolvido ou a funcionalidade adicionada no PR.
- Evite incluir credenciais reais, tokens ou dados sensíveis em commits.

Encontrou um bug ou tem uma sugestão? Abra uma **Issue** no repositório.

---

## 💖 Apoie o Projeto

A Flash API é gratuita e de código aberto. Se ela ajuda você ou a sua empresa, considere contribuir com qualquer valor: isso mantém o projeto atualizado e com novos recursos.

**Chave Pix (aleatória):**

```
d47cd9b2-072a-4856-a830-427ee4fc2dde
```

Outras formas de apoiar: deixe uma ⭐ no repositório, indique o projeto para outras pessoas e reporte bugs.

---

## 📄 Licença

Este projeto está licenciado sob a licença **MIT** — conforme declarado em `package.json`. Consulte o arquivo `LICENSE` do repositório (ou adicione um, caso ainda não exista) para o texto completo.

```
MIT License — livre para uso, cópia, modificação e distribuição,
mantendo o aviso de copyright original.
```

---

<div align="center">

Feito com ⚡ para a comunidade open source.

</div>
