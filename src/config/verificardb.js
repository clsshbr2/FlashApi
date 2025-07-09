const logger = require("../utils/logger");
const Database = require("./database");


const db = new Database();

async function modifyTable() {

    //Criar coluna creds em sessao
    try {
        const [columns] = await db.execute(`SHOW COLUMNS FROM sessao LIKE 'creds'`);
        if (!columns) {
            await db.execute(`ALTER TABLE sessao ADD COLUMN creds JSON`);
            logger.info('✅ Coluna "creds" criada como JSON.')

        }
    } catch (error) { }

    //Criar coluna code em sessao
    try {
        const [columns] = await db.execute(`SHOW COLUMNS FROM sessao LIKE 'code'`);
        if (!columns) {
            await db.execute(`ALTER TABLE sessao ADD COLUMN code VARCHAR(50)`);
            logger.info('✅ Coluna "code" criada como VARCHAR(50).')
        }
    } catch (error) { }
}
modifyTable();

module.exports = { modifyTable }
