# Integração com o WhatsApp (zapo-js)

A Flash API usa **somente** a [zapo-js](https://github.com/vinikjkkj/zapo) para falar com o WhatsApp.
Este guia explica como a integração está organizada, o que muda ao implantar e como dar manutenção.

> Payloads de webhook e eventos de WebSocket continuam iguais aos da versão que usava Baileys. As rotas de leitura (`/chat/messages`, `/chat/chats`, `/contact/list`) agora leem o que a zapo guarda e mudaram de formato (ver seção 3).

---

## 1. Implantação

1. `npm install` (o `.npmrc` com `legacy-peer-deps=true` é necessário: a zapo declara `pino@^9` como peer **opcional** e o projeto usa `pino@8`).
2. As tabelas da zapo (`zapo_*`) são criadas **sozinhas** na primeira conexão. Não é preciso rodar migration.
3. **Todas as sessões precisam ser conectadas de novo** (QR Code ou código). As credenciais da Baileys não são reaproveitadas.
   Sessões antigas ficam cadastradas na tabela `sessao` e pedem QR ao reiniciar a API.
4. A tabela antiga `wa_session_keys` não é mais usada. Pode ser apagada quando quiser: `DROP TABLE wa_session_keys;`.

Variáveis de ambiente relacionadas (`.env.example`):

| Variável | Padrão | Para que serve |
|---|---|---|
| `WA_LOG_LEVEL` | `LOG_LEVEL` | Nível de log da zapo (aceita também o antigo `BAILEYS_LOG_LEVEL`). |
| `VERSION_ZAP` | `[2, 3000, 1043914743]` | Versão do WhatsApp Web anunciada (convertida para `2.3000.1043914743`). |
| `SESSION_PHONE_CLIENT` / `SESSION_PHONE_NAME` | `Flash_api` / `Chrome` | Nome do SO e do navegador em "Aparelhos conectados". |
| `ZAPO_DB_POOL_MAX` | `10` | Conexões do pool PostgreSQL da zapo. |
| `PROXY_*` | — | Proxy global; o proxy por sessão (tabela `proxy`) tem prioridade. |

---

## 2. Arquitetura

```
Rotas / Serviços
        │   sock.sendMessage(), sock.groupMetadata(), sock.ev.on(...)
        ▼
WhatsAppService  ──►  SessaoWhatsApp (1 por sessão)  ──►  WaClient (zapo-js)  ──►  PostgreSQL (zapo_*)
                          ├─ conteudo.js : corpo da requisição  →  conteúdo da zapo
                          └─ eventos.js  : eventos da zapo      →  eventos publicados pela API
```

| Arquivo | Responsabilidade |
|---|---|
| `src/services/WhatsAppService.js` | Mapa de sessões ativas, `createSession`, proxy, reconexão em lote ao iniciar, desligamento limpo. |
| `src/whatsapp/SessaoWhatsApp.js` | Uma conexão: envio, grupos, contatos, presença, leitura, download de mídia, `end()`/`logout()`. |
| `src/whatsapp/conteudo.js` | Converte `{ image, caption }`, `{ poll }`, `{ react }`... para os tipos da zapo. |
| `src/whatsapp/eventos.js` | Converte `message`, `receipt`, `connection`, `group`, `call`... em `messages.upsert`, `message-receipt.update`, `connection.update`... (mesmos nomes e formato de sempre). Também junta o voto de enquete decifrado à mensagem. |
| `src/whatsapp/store.js` | Store PostgreSQL da zapo, limpeza periódica de caches, remoção dos dados de uma sessão e consultas (mensagens, chats, contatos, estatísticas). |
| `src/whatsapp/importarCredenciais.js` | Importa a sessão enviada pela extensão do navegador (`POST /api/session/creds`). |
| `src/whatsapp/utils.js` | JIDs, base64, download de mídia por URL; adaptador do logger. |
| `src/services/buttonsService.js` | Lista, botões, mensagem interativa e carrossel (proto puro). |

Fluxo de conexão: `createSession` → cria `SessaoWhatsApp` → `registrarEventos` (liga webhooks/WebSocket) → `iniciar()` (conecta).
A zapo **não reconecta sozinha**: a reconexão continua em `connection_update.js`, que reage ao `connection.update` com códigos
`428` (reconectar), `401 + "Intentional Logout"` (remover sessão) e `408` (QR expirado → novo ciclo).

---

## 3. Diferenças em relação à versão com Baileys

1. **Sessões**: precisam ser reconectadas uma vez (credenciais não migradas).
2. **Armazenamento**: a zapo guarda mensagens, chats e contatos sozinha (`zapo_mailbox_*`); a API não grava nada manualmente. As rotas `/chat/messages`, `/chat/chats`, `/contact/list` e `/config/session` só leem essas tabelas (`src/whatsapp/store.js`).
   As tabelas antigas `mensagens`, `chats`, `contatos` e `grupos` não são mais usadas.
3. **Votos de enquete**: decifrados pela própria zapo (`message_addon`) e publicados em `pollUpdateMessage.vote`.
   O segredo da enquete fica em `zapo_*` (sobrevive a reinícios). Voto de enquete criada antes de a sessão existir chega com `vote: []`.
4. **Rejeitar chamada**: a zapo só recebe sinalização de chamada; a rejeição é enviada como nó `<call><reject/></call>` (`SessaoWhatsApp.rejectCall`).
5. **Botões/listas/carrossel**: a zapo monta os nós `biz` sozinha. Aparência no celular deve ser conferida.
6. **Miniaturas automáticas** de mídia não são geradas (precisaria de `@zapo-js/media-utils` + `sharp`).
7. **Rota `POST /api/session/creds`** (extensão): converte as credenciais com `wa-store-migrate` e grava na zapo. Funciona só com as pre-keys enviadas pela extensão; **não foi testada com uma sessão real do WhatsApp Web**.
8. **Mapa LID ↔ telefone** é alimentado pelos campos `remoteJidAlt`/`participantAlt`, por eventos de grupo e por `/api/contact/check`.

---

## 4. Checklist de testes (com um número de teste)

- [ ] Sessão nova: `PUT /api/session/conectar_sessao` gera QR e conecta.
- [ ] Pareamento por código (informando `numero`).
- [ ] Reiniciar a API: a sessão reconecta **sem** novo QR (prova que as credenciais foram gravadas).
- [ ] Desligar a API com Ctrl+C / `docker stop` e subir de novo: sessões voltam sem QR (prova do flush no desligamento).
- [ ] Receber texto: webhook `messages_upsert` com o mesmo formato de antes.
- [ ] Enviar: texto, imagem, vídeo, áudio PTT, documento, figurinha, localização, contato, reação, enquete, apagar.
- [ ] Votar em enquete: webhook com `pollUpdateMessage.vote` preenchido.
- [ ] Lista, botões, mensagem interativa e carrossel (com e sem mídia).
- [ ] Grupos: listar, info, criar, participantes, assunto, descrição, configurações, convite, sair.
- [ ] Recibos (`message_receipt_update`, `messages_update`).
- [ ] Rejeição automática de chamada (com e sem mensagem).
- [ ] Status/Stories (texto com cor/fonte e imagem).
- [ ] Proxy individual e global.
- [ ] `/api/chat/midiaToBase64` com imagem, vídeo e áudio recebidos.
- [ ] `DELETE /api/session/desconect` e `/delete/:id` removem a sessão e os dados `zapo_*`.
- [ ] Extensão: `POST /api/session/creds`.

Dica: `WA_LOG_LEVEL=debug` mostra os logs da zapo (prefixo `[zapo]`).

---

## 5. Manutenção

- **Novo tipo de mensagem**: adicione um bloco em `conteudo.js` (`converterConteudo`).
- **Novo evento para webhook**: `client.on(...)` em `eventos.js`, emitindo com o nome/formato publicado, e registre o nome em `EventService.js`.
- **Novo método usado por uma rota**: implemente em `SessaoWhatsApp.js`.
- **Referência da zapo**: <https://zapo.to> (`/llms.txt` lista os guias) e os tipos em `node_modules/zapo-js/dist`.

| Sintoma | Causa provável / solução |
|---|---|
| `npm install` falha com `ERESOLVE` | Falta o `.npmrc` (`legacy-peer-deps=true`). |
| Pede QR a cada reinício | Credenciais não foram gravadas: veja erros do PostgreSQL e confirme o desligamento limpo. |
| `companion hello iq failed (400)` | Pareamento por código pedido cedo demais; a API já espera `auth_pairing_required`. Se persistir, confira o formato do `numero`. |
| Mensagem enviada e não entregue (lista/botão) | Teste o tipo específico e, se preciso, abra uma issue na zapo. |
