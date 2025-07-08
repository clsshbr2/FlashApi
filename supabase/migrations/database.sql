-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: localhost:3306
-- Tempo de geração: 08-Jul-2025 às 01:19
-- Versão do servidor: 8.0.30
-- versão do PHP: 8.2.22

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Banco de dados: `flashapi`
--

-- --------------------------------------------------------

--
-- Estrutura da tabela `chats`
--

CREATE TABLE `chats` (
  `id` int NOT NULL,
  `sessao_id` varchar(255) NOT NULL,
  `jid` varchar(255) NOT NULL,
  `nome` varchar(255) DEFAULT NULL,
  `eh_grupo` tinyint(1) DEFAULT '0',
  `mensagens_nao_lidas` int DEFAULT '0',
  `ultima_mensagem` bigint DEFAULT NULL,
  `arquivado` tinyint(1) DEFAULT '0',
  `fixado` tinyint(1) DEFAULT '0',
  `silenciado_ate` bigint DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Estrutura da tabela `contatos`
--

CREATE TABLE `contatos` (
  `id` int NOT NULL,
  `sessao_id` varchar(255) NOT NULL,
  `jid` varchar(255) NOT NULL,
  `nome` varchar(255) DEFAULT NULL,
  `apelido` varchar(255) DEFAULT NULL,
  `nome_verificado` varchar(255) DEFAULT NULL,
  `url_imagem` text,
  `status_contato` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Estrutura da tabela `grupos`
--

CREATE TABLE `grupos` (
  `id` int NOT NULL,
  `sessao_id` varchar(255) NOT NULL,
  `jid` varchar(255) NOT NULL,
  `assunto` varchar(255) DEFAULT NULL,
  `dono_assunto` varchar(255) DEFAULT NULL,
  `data_assunto` bigint DEFAULT NULL,
  `data_criacao` bigint DEFAULT NULL,
  `dono_grupo` varchar(255) DEFAULT NULL,
  `descricao_grupo` text,
  `dono_descricao` varchar(255) DEFAULT NULL,
  `id_descricao` varchar(255) DEFAULT NULL,
  `restrito_mensagens` tinyint(1) DEFAULT '0',
  `apenas_admins` tinyint(1) DEFAULT '0',
  `tamanho_grupo` int DEFAULT '0',
  `participantes` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Estrutura da tabela `mensagens`
--

CREATE TABLE `mensagens` (
  `id` int NOT NULL,
  `sessao_id` varchar(255) NOT NULL,
  `mensagem_id` varchar(255) NOT NULL,
  `remoteJid` varchar(255) NOT NULL,
  `fromMe` tinyint(1) DEFAULT '0',
  `isgrupo` tinyint(1) DEFAULT '0',
  `participant` varchar(255) DEFAULT NULL,
  `tipo_mensagem` varchar(50) DEFAULT 'text',
  `conteudo_mensagem` json DEFAULT NULL,
  `timestamp` bigint DEFAULT NULL,
  `status` enum('received','sent','delivered','read') DEFAULT 'received',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Estrutura da tabela `sessao`
--

CREATE TABLE `sessao` (
  `id` int NOT NULL,
  `apikey` varchar(255) NOT NULL,
  `numero` varchar(20) DEFAULT NULL,
  `nome_sessao` varchar(100) NOT NULL,
  `status` enum('disconnected','connecting','connected','qr_ready','reconnecting') DEFAULT 'disconnected',
  `qrcode` text,
  `webhook_url` varchar(500) DEFAULT NULL,
  `ignorar_grupos` tinyint(1) DEFAULT '0',
  `leitura_automatica` tinyint(1) DEFAULT '0',
  `resposta_automatica` tinyint(1) DEFAULT '0',
  `mensagem_automatica` text,
  `rejeitar_ligacoes` tinyint(1) DEFAULT '1',
  `msg_rejectCalls` longtext,
  `active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `webhook_status` int NOT NULL DEFAULT '0',
  `events` json DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Índices para tabelas despejadas
--

--
-- Índices para tabela `chats`
--
ALTER TABLE `chats`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_chat` (`sessao_id`,`jid`),
  ADD KEY `idx_sessao_id` (`sessao_id`),
  ADD KEY `idx_ultima_mensagem` (`ultima_mensagem`);

--
-- Índices para tabela `contatos`
--
ALTER TABLE `contatos`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_contact` (`sessao_id`,`jid`),
  ADD KEY `idx_sessao_id` (`sessao_id`);

--
-- Índices para tabela `grupos`
--
ALTER TABLE `grupos`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_group` (`sessao_id`,`jid`),
  ADD KEY `idx_sessao_id` (`sessao_id`);

--
-- Índices para tabela `mensagens`
--
ALTER TABLE `mensagens`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_message` (`sessao_id`,`mensagem_id`),
  ADD KEY `idx_sessao_id` (`sessao_id`),
  ADD KEY `idx_remote_jid` (`remoteJid`),
  ADD KEY `idx_timestamp` (`timestamp`);

--
-- Índices para tabela `sessao`
--
ALTER TABLE `sessao`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `apikey` (`apikey`);

--
-- AUTO_INCREMENT de tabelas despejadas
--

--
-- AUTO_INCREMENT de tabela `chats`
--
ALTER TABLE `chats`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `contatos`
--
ALTER TABLE `contatos`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `grupos`
--
ALTER TABLE `grupos`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `mensagens`
--
ALTER TABLE `mensagens`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `sessao`
--
ALTER TABLE `sessao`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=15;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
