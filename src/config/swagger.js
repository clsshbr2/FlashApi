
const fs = require('fs');
const path = require('path');
const config = require('./env');

const webhookPath = JSON.parse(fs.readFileSync(path.join(__dirname, '../routes/docsJson/docs_config.json'), 'utf8'));
const docs_chats = JSON.parse(fs.readFileSync(path.join(__dirname, '../routes/docsJson/docs_chats.json'), 'utf8'));
const docs_contact = JSON.parse(fs.readFileSync(path.join(__dirname, '../routes/docsJson/docs_contact.json'), 'utf8'));
const docs_sessao = JSON.parse(fs.readFileSync(path.join(__dirname, '../routes/docsJson/docs_sessao.json'), 'utf8'));
const docs_grupos = JSON.parse(fs.readFileSync(path.join(__dirname, '../routes/docsJson/docs_grupos.json'), 'utf8'));
const docs_system = JSON.parse(fs.readFileSync(path.join(__dirname, '../routes/docsJson/docs_system.json'), 'utf8'));

const PORT = config.port;
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Flash API',
      version: '1.0.0',
      description: 'API completa para gerenciamento de múltiplas sessões WhatsApp',
      contact: {
        name: 'API Support',
        email: 'quickgestor@gmail.com'
      }
    },
    servers: [
      {
        url: `${config.hostapi}/api`,
        description: 'Servidor de Beta'
      }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'apikey',
          description: 'API Key para autenticação'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            message: {
              type: 'string'
            },
            error: {
              type: 'string'
            }
          }
        },
        Success: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            message: {
              type: 'string'
            },
            data: {
              type: 'object'
            }
          }
        }
      }
    },
        security: [
      {
        ApiKeyAuth: []
      }
    ],
    paths: {
      ...docs_chats,
      ...webhookPath,
      ...docs_contact,
      ...docs_sessao,
      ...docs_grupos,
      ...docs_system
    }
  },
  apis: ['./src/routes/*.js'] // Path to files containing OpenAPI definitions
};

module.exports = { swaggerOptions };