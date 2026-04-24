-- Compatível com MySQL 8+ e PostgreSQL 15+

CREATE TABLE IF NOT EXISTS chats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sessao_id VARCHAR(255) NOT NULL,
  jid VARCHAR(255) NOT NULL,
  nome VARCHAR(255),
  eh_grupo BOOLEAN DEFAULT FALSE,
  mensagens_nao_lidas INT DEFAULT 0,
  ultima_mensagem BIGINT,
  arquivado BOOLEAN DEFAULT FALSE,
  fixado BOOLEAN DEFAULT FALSE,
  silenciado_ate BIGINT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_chat (sessao_id, jid),
  INDEX idx_sessao_id_chats (sessao_id),
  INDEX idx_ultima_mensagem (ultima_mensagem)
);

CREATE TABLE IF NOT EXISTS contatos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sessao_id VARCHAR(255) NOT NULL,
  jid VARCHAR(255) NOT NULL,
  nome VARCHAR(255),
  apelido VARCHAR(255),
  nome_verificado VARCHAR(255),
  url_imagem TEXT,
  status_contato TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_contact (sessao_id, jid),
  INDEX idx_sessao_id_contatos (sessao_id)
);

CREATE TABLE IF NOT EXISTS grupos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sessao_id VARCHAR(255) NOT NULL,
  jid VARCHAR(255) NOT NULL,
  assunto VARCHAR(255),
  dono_assunto VARCHAR(255),
  data_assunto BIGINT,
  data_criacao BIGINT,
  dono_grupo VARCHAR(255),
  descricao_grupo TEXT,
  dono_descricao VARCHAR(255),
  id_descricao VARCHAR(255),
  restrito_mensagens BOOLEAN DEFAULT FALSE,
  apenas_admins BOOLEAN DEFAULT FALSE,
  tamanho_grupo INT DEFAULT 0,
  participantes JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_group (sessao_id, jid),
  INDEX idx_sessao_id_grupos (sessao_id)
);

CREATE TABLE IF NOT EXISTS mensagens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sessao_id VARCHAR(255) NOT NULL,
  mensagem_id VARCHAR(255) NOT NULL,
  remoteJid VARCHAR(255) NOT NULL,
  fromMe BOOLEAN DEFAULT FALSE,
  isgrupo BOOLEAN DEFAULT FALSE,
  participant VARCHAR(255),
  tipo_mensagem VARCHAR(50) DEFAULT 'text',
  conteudo_mensagem JSON,
  timestamp BIGINT,
  status VARCHAR(10) DEFAULT 'received',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT status_enum CHECK (status IN ('received','sent','delivered','read')),
  UNIQUE KEY unique_message (sessao_id, mensagem_id),
  INDEX idx_sessao_id_mensagens (sessao_id),
  INDEX idx_remote_jid (remoteJid),
  INDEX idx_timestamp (timestamp)
);


CREATE TABLE IF NOT EXISTS sessao (
  id INT AUTO_INCREMENT PRIMARY KEY,
  apikey VARCHAR(255) NOT NULL UNIQUE,
  numero VARCHAR(20),
  nome_sessao VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'disconnected',
  qrcode TEXT,
  webhook_url VARCHAR(500),
  ignorar_grupos BOOLEAN DEFAULT FALSE,
  leitura_automatica BOOLEAN DEFAULT FALSE,
  resposta_automatica BOOLEAN DEFAULT FALSE,
  mensagem_automatica TEXT,
  rejeitar_ligacoes BOOLEAN DEFAULT TRUE,
  msg_rejectcalls TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  webhook_status INT DEFAULT 0,
  events JSON,
  CONSTRAINT sessao_status_enum CHECK (status IN ('disconnected','connecting','connected','qr_ready','reconnecting'))
);

CREATE TABLE IF NOT EXISTS proxy (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mainid INT NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INT NOT NULL,
  protocol VARCHAR(20) NOT NULL,
  username VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS baileys_sessions (
  id VARCHAR(255) PRIMARY KEY,
  auth JSON NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Tabela de credenciais Baileys persistidas no banco (substitui Redis para auth)
CREATE TABLE IF NOT EXISTS wa_sessions (
  session_id VARCHAR(255) PRIMARY KEY,
  creds_json MEDIUMTEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Tabela de signal keys Baileys persistidas no banco
CREATE TABLE IF NOT EXISTS wa_session_keys (
  session_id VARCHAR(255) NOT NULL,
  key_type VARCHAR(100) NOT NULL,
  key_id VARCHAR(255) NOT NULL,
  value_json MEDIUMTEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, key_type, key_id),
  INDEX idx_wa_session_keys_session (session_id)
);