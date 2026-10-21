# Migração da Baileys para a zapo-js

Este documento explica **como a migração foi feita**, **como ativar**, **como voltar atrás**
e **o que precisa ser testado** antes de usar em produção.

> **Resumo:** nenhum endpoint, payload de webhook ou evento de WebSocket mudou.
> A API continua falando "Baileys" por dentro; uma camada de compatibilidade
> (`src/providers/zapo/`) traduz tudo para a [zapo-js](https://github.com/vinikjkkj/zapo).
> O provedor é escolhido pela variável `WA_PROVIDER` (`baileys` ou `zapo`).

---

## 1. Como ativar

1. Instale as dependências (já estão no `package.json`):

   ```bash
   npm install
   ```

   > Existe um `.npmrc` com `legacy-peer-deps=true`. Ele é necessário porque a zapo-js
   > declara `pino@^9` como peer **opcional** e o projeto usa `pino@8`.

2. (Opcional, recomendado) Converta as sessões existentes **sem derrubar a API**:

   ```bash
   npm run migrar:zapo -- --simular      # só mostra o que seria migrado
   npm run migrar:zapo                   # migra todas
   npm run migrar:zapo -- --sessao=APIKEY   # migra apenas uma
   ```

3. No `.env`:

   ```env
   WA_PROVIDER=zapo
   ```

4. Reinicie a API. Cada sessão conecta usando a zapo.
   Sessões antigas da Baileys são **importadas automaticamente** na primeira conexão
   (se você não rodou o passo 2), **sem pedir novo QR Code**.

### Voltar para a Baileys (rollback)

Basta `WA_PROVIDER=baileys` e reiniciar. Os dados da Baileys (`wa_session_keys`) **não são apagados
pela migração**, então a sessão volta como estava.

> ⚠️ Cuidado: depois que a sessão rodou na zapo, o estado Signal avança (novas chaves/ratchets).
> Voltar para a Baileys com o estado *antigo* pode causar falhas de decriptação em conversas
> ativas. Faça o rollback logo no início do teste, ou aceite parear de novo (QR) em caso de problema.

---

## 2. Como funciona (arquitetura)

```
Rotas / Serviços / Workers (INALTERADOS)
          │  usam sock.sendMessage(), sock.groupMetadata(), sock.ev.on(...)
          ▼
   BaileysService.createSession()
          │  WA_PROVIDER=baileys → makeWASocket()        (código original)
          │  WA_PROVIDER=zapo    → createSessionZapo()
          ▼
   ZapoSocket  ← imita o socket da Baileys
     ├─ conteudo.js  : conteúdo de mensagens  Baileys → zapo
     ├─ eventos.js   : eventos                zapo → Baileys
     ├─ store.js     : PostgreSQL da zapo (tabelas zapo_*)
     ├─ migrarCredenciais.js : importa wa_session_keys → zapo
     └─ WaClient (zapo-js)
```

### Arquivos novos

| Arquivo | Para que serve |
|---|---|
| `src/providers/zapo/ZapoSocket.js` | Classe com a mesma interface do socket da Baileys (`sendMessage`, `relayMessage`, `group*`, `readMessages`, `onWhatsApp`, `ev`, `user`, `end`, `logout`...). |
| `src/providers/zapo/conteudo.js` | Converte o conteúdo enviado (`{ image, caption }`) para o formato da zapo (`{ type: "image", media, caption }`). |
| `src/providers/zapo/eventos.js` | Converte eventos da zapo (`message`, `receipt`, `connection`...) para os da Baileys (`messages.upsert`, `message-receipt.update`, `connection.update`...). |
| `src/providers/zapo/store.js` | Cria o store PostgreSQL da zapo e limpa os dados de uma sessão. |
| `src/providers/zapo/migrarCredenciais.js` | Converte credenciais/chaves da Baileys para a zapo usando `wa-store-migrate`. |
| `src/providers/zapo/utils.js` | Funções auxiliares (JIDs, base64, download de mídia, JSON no padrão Baileys). |
| `src/providers/zapo/logger.js` | Adaptador do logger do projeto para a zapo. |
| `src/services/midiaBotoes.js` | Upload de mídia para botões/carrossel (zapo ou Baileys). |
| `scripts/migrar-para-zapo.js` | Migração em lote das sessões (`npm run migrar:zapo`). |

### Arquivos existentes alterados (mudanças mínimas)

| Arquivo | O que mudou |
|---|---|
| `src/services/BaileysService.js` | `createSession` desvia para `createSessionZapo` quando `WA_PROVIDER=zapo`; novos `getSocket`, `resolverProxyUrl`, `encerrarTodas`. |
| `src/services/buttonsService.js` | `prepareWAMessageMedia(...)` → `prepararMidia(sock, ...)` (6 chamadas). |
| `src/models/Session.js` | `delete()` também limpa os dados da zapo. |
| `src/config/env.js` | Nova variável `waProvider`. |
| `server.js` | No desligamento (SIGTERM/SIGINT) a zapo grava as chaves pendentes. |
| `.env.example`, `package.json`, `.npmrc`, `Dockerfile` | Variáveis, dependências e flag do npm. |

### Banco de dados

- A zapo cria **sozinha** as tabelas `zapo_*` na primeira conexão (não precisa mexer no `postgres.sql`).
- Por padrão a zapo **não** guarda mensagens/chats/contatos (a API já tem as tabelas dela).
  Para a zapo guardar também: `ZAPO_STORE_HISTORICO=true`.
- `Session.delete()` apaga os dados da zapo daquela sessão automaticamente.

---

## 3. Equivalência de funcionalidades

| Recurso da API | Baileys | zapo (implementação) | Situação |
|---|---|---|---|
| Texto, imagem, vídeo, áudio, PTT, documento, figurinha | `sendMessage` | `message.send` com `type` | ✅ convertido |
| Responder (`quoted`), menções, `MarkAll` | `sendMessage` | opções `quote` / `mentions` | ✅ |
| Reação, apagar para todos, enquete | `sendMessage` | `reaction` / `revoke` / `poll` | ✅ |
| Localização, contato (vCard) | `sendMessage` | proto `locationMessage` / `contactMessage` | ✅ |
| Status/Stories (`status@broadcast`) | `sendMessage` + `statusJidList` | `status.send({ recipients })` | ✅ cor de fundo/fonte via proto bruto |
| Lista, botões, interativa, carrossel | `relayMessage` + nós `biz` | `message.send` com proto | ⚠️ **testar** (a zapo monta os nós biz sozinha) |
| `externalAdReply` | `contextInfo` | `contextInfo.raw` | ⚠️ testar |
| Digitando / gravando / pausado | `sendPresenceUpdate` | `presence.sendChatstate` | ✅ |
| Marcar como lido | `readMessages` | `message.sendReceipt(type: "read")` | ✅ |
| Verificar número (`/check`) | `onWhatsApp` | `profile.getLidsByPhoneNumbers` | ⚠️ formato do retorno adaptado |
| Foto de perfil, bloquear/desbloquear | `profilePictureUrl`, `updateBlockStatus` | `profile.getProfilePicture`, `privacy.blockUser` | ✅ |
| Grupos (listar, info, criar, participantes, assunto, descrição, config, convite) | `group*` | `client.group.*` | ✅ |
| Rejeitar chamadas automaticamente | `rejectCall` | nó `<call><reject/>` via `lowlevel.sendNode` | ⚠️ testar |
| QR Code e pareamento por código | `connection.update` / `requestPairingCode` | `auth_qr` / `auth.requestPairingCode` | ✅ QR testado; código ⚠️ |
| Proxy por sessão e global | `agent` | `proxy: { ws, mediaUpload, ... }` | ⚠️ testar |
| Votos de enquete | `decryptPollVote` (código da API) | mantido (usa os mesmos campos em base64) | ⚠️ testar |
| Webhook / WebSocket | eventos da Baileys | mesmos nomes e formato de dados | ✅ (conferir) |

---

## 4. Diferenças e limitações conhecidas

1. **Histórico inicial (`messaging-history.set`)**: a zapo não entrega as listas de chats/contatos/mensagens
   no evento (só contagens). Por isso a sincronização inicial **não alimenta** as tabelas `chats`/`contatos`/`mensagens`
   da API como a Baileys fazia. Mensagens novas continuam sendo gravadas normalmente. Contatos e chats passam a
   ser preenchidos conforme chegam mensagens. Se isso for crítico, é preciso uma fase 2 lendo o store da zapo
   (`ZAPO_STORE_HISTORICO=true`).
2. **Reconexão**: a zapo não reconecta sozinha. A API continua reconectando pelo mesmo fluxo de antes
   (`connection_update.js`), pois o `ZapoSocket` emite o mesmo `connection.update` com códigos no estilo Baileys
   (428 = reconectar, 401 + "Intentional Logout" = remover sessão, 408 = QR expirado).
3. **Código 515** (reinício pós-pareamento): a zapo faz isso internamente, não gera evento.
4. **Mapeamento LID ↔ telefone** agora é alimentado pelos campos `remoteJidAlt`/`participantAlt` das mensagens,
   pelos eventos de grupo e por `/check` (antes vinha de chaves `lid-mapping` da Baileys).
5. **Mídia**: URLs/base64 são baixadas/decodificadas pela API antes de enviar (a zapo recebe buffer).
   O áudio PTT continua sendo convertido para Opus pelo ffmpeg da API.
   Miniaturas (thumbnails) automáticas não são geradas (precisaria de `@zapo-js/media-utils` + `sharp`).
6. **Dependência da Baileys**: o pacote `@whiskeysockets/baileys` continua instalado porque o projeto ainda usa
   utilitários dele que não dependem de conexão (`proto`, `generateWAMessageFromContent`, `downloadMediaMessage`,
   `decryptPollVote`...). Uma "fase 2" poderia removê-lo por completo.
7. **Versão do WhatsApp Web**: `VERSION_ZAP` é repassada à zapo (ex.: `[2, 3000, 1043914743]` → `2.3000.1043914743`).
8. **Não testado com contas reais**: ver checklist abaixo.

---

## 5. Checklist de testes (faça com um número de teste)

Marque cada item antes de migrar produção:

- [ ] Sessão nova: `PUT /api/session/conectar_sessao` gera QR; ler o QR conecta (`status = connected`).
- [ ] Pareamento por código (informando `numero`).
- [ ] Reiniciar a API: a sessão reconecta sozinha, **sem novo QR**.
- [ ] Sessão antiga da Baileys: `npm run migrar:zapo -- --simular`, depois migrar e conectar **sem QR**.
- [ ] Receber mensagem de texto: chega o webhook `messages_upsert` com o mesmo formato de antes.
- [ ] Enviar: texto, imagem, vídeo, áudio PTT, documento, figurinha, localização, contato, reação, enquete, apagar.
- [ ] Votar em enquete e conferir o webhook com `pollUpdateMessage.vote`.
- [ ] Lista, botões, mensagem interativa e carrossel (aparência no celular).
- [ ] Mensagem em grupo + menção (`MarkAll`).
- [ ] Rotas de grupo: listar, info, criar, adicionar/remover/promover, assunto, descrição, configurações, convite.
- [ ] Recibos (entregue/lido) chegam como `message_receipt_update` / `messages_update`.
- [ ] Rejeição automática de chamada (com e sem mensagem).
- [ ] Status/Stories.
- [ ] Sessão com proxy (individual e global).
- [ ] `DELETE /api/session/desconect` e `DELETE /api/session/delete/:id` removem a sessão e os dados `zapo_*`.
- [ ] Desligar a API (Ctrl+C / `docker stop`) e subir de novo: sessões voltam sem QR (prova que o flush funcionou).

Dica: ative `BAILEYS_LOG_LEVEL=debug` para ver os logs da zapo (prefixo `[zapo]`).

---

## 6. Manutenção: como estender

- **Novo tipo de mensagem**: adicione um bloco em `conteudo.js` (`converterConteudo`) mapeando o formato Baileys → `type` da zapo.
- **Novo evento para webhook**: adicione um `client.on(...)` em `eventos.js` e emita com o **nome e formato da Baileys**
  (depois registre o nome em `EventService.js`, como já é feito hoje).
- **Novo método do socket** usado por uma rota nova: implemente em `ZapoSocket.js` com a mesma assinatura da Baileys.
- **Referência da zapo**: <https://zapo.to> (`/llms.txt` lista todos os guias) e os tipos em `node_modules/zapo-js/dist`.

## 7. Problemas comuns

| Sintoma | Causa provável / solução |
|---|---|
| `npm install` falha com `ERESOLVE` | Falta o `.npmrc` (`legacy-peer-deps=true`). |
| Sessão fica em `connecting` | Confira `VERSION_ZAP`, proxy e os logs `[zapo]`. |
| QR não aparece | O primeiro evento é emitido logo após registrar os listeners; veja os logs de erro de conexão. |
| Mensagem enviada mas não chega (lista/botão) | A zapo envia sem os nós `biz` manuais; teste o tipo específico e abra uma issue na zapo se necessário. |
| `Número inválido para pareamento por código` | Informe o número com DDI+DDD, só dígitos. |
| Sessão importada pede QR | A importação falhou (ver log "falha ao importar credenciais"); gere novo QR ou reconverta com `npm run migrar:zapo`. |
