CREATE TABLE IF NOT EXISTS chats (
    "sessao_id" VARCHAR(255) NOT NULL,
    "jid" VARCHAR(255) NOT NULL,
    "nome" VARCHAR(255) NULL,
    "eh_grupo" BOOLEAN NULL DEFAULT false,
    "mensagens_nao_lidas" INTEGER NULL DEFAULT 0,
    "arquivado" BOOLEAN NULL DEFAULT false,
    "fixado" BOOLEAN NULL DEFAULT false,
    "silenciado_ate" BIGINT NULL,
    "dados" JSON NULL,
    "created_at" TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chats_sessao_id_jid_key" UNIQUE ("sessao_id", "jid")
);

CREATE TABLE IF NOT EXISTS contatos (
    "sessao_id" VARCHAR(255) NOT NULL,
    "jid" VARCHAR(255) NOT NULL,
    "nome" VARCHAR(255) NULL,
    "apelido" VARCHAR(255) NULL,
    "nome_verificado" VARCHAR(255) NULL,
    "url_imagem" TEXT NULL,
    "status_contato" TEXT NULL,
    "created_at" TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contatos_sessao_id_jid_key" UNIQUE ("sessao_id", "jid")
);

CREATE TABLE IF NOT EXISTS grupos (
    "sessao_id" VARCHAR(255) NOT NULL,
    "jid" VARCHAR(255) NOT NULL,
    "assunto" VARCHAR(255) NULL,
    "dono_assunto" VARCHAR(255) NULL,
    "data_assunto" BIGINT NULL,
    "data_criacao" BIGINT NULL,
    "dono_grupo" VARCHAR(255) NULL,
    "descricao_grupo" TEXT NULL,
    "dono_descricao" VARCHAR(255) NULL,
    "id_descricao" VARCHAR(255) NULL,
    "restrito_mensagens" BOOLEAN NULL DEFAULT false,
    "apenas_admins" BOOLEAN NULL DEFAULT false,
    "tamanho_grupo" INTEGER NULL DEFAULT 0,
    "participantes" JSON NULL,
    "created_at" TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "grupos_sessao_id_jid_key" UNIQUE ("sessao_id", "jid")
);

CREATE TABLE IF NOT EXISTS sessao (
  "apikey" VARCHAR(255) NOT NULL,
  "numero" VARCHAR(20) NULL,
  "nome_sessao" VARCHAR(100) NOT NULL,
  "status" VARCHAR(20) NULL DEFAULT 'disconnected'::character varying ,
  "qrcode" TEXT NULL,
  "webhook_url" VARCHAR(500) NULL,
  "ignorar_grupos" BOOLEAN NULL DEFAULT false ,
  "leitura_automatica" BOOLEAN NULL DEFAULT false ,
  "resposta_automatica" BOOLEAN NULL DEFAULT false ,
  "mensagem_automatica" TEXT NULL,
  "rejeitar_ligacoes" BOOLEAN NULL DEFAULT true ,
  "msg_rejectcalls" TEXT NULL,
  "active" BOOLEAN NULL DEFAULT true ,
  "created_at" TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ,
  "updated_at" TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ,
  "webhook_status" INTEGER NULL DEFAULT 0 ,
  "events" JSON NULL,
  "code" VARCHAR(50) NULL,
  CONSTRAINT "sessao_pkey" PRIMARY KEY ("apikey"),
  CONSTRAINT "sessao_apikey_key" UNIQUE ("apikey")
);

CREATE TABLE IF NOT EXISTS mensagens ( 
  "sessao_id" VARCHAR(255) NOT NULL,
  "mensagem_id" VARCHAR(255) NOT NULL,
  "remotejid" VARCHAR(255) NOT NULL,
  "fromme" BOOLEAN NULL DEFAULT false ,
  "isgrupo" BOOLEAN NULL DEFAULT false ,
  "participant" VARCHAR(255) NULL,
  "tipo_mensagem" VARCHAR(50) NULL DEFAULT 'text'::character varying ,
  "conteudo_mensagem" JSON NULL,
  "timestamp" BIGINT NULL,
  "status" VARCHAR(10) NULL DEFAULT 'received'::character varying ,
  "created_at" TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ,
  CONSTRAINT "mensagens_sessao_id_mensagem_id_key" UNIQUE ("sessao_id", "mensagem_id")
);

CREATE TABLE IF NOT EXISTS proxy (
    "sessao_id" VARCHAR(255) NOT NULL,
    "host" VARCHAR(255) NOT NULL,
    "port" INTEGER NOT NULL,
    "protocol" VARCHAR(20) NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NULL,
    CONSTRAINT "proxy_sessao_id_key" UNIQUE ("sessao_id")
);
