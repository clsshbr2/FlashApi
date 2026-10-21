/**
 * Migração EM LOTE das sessões da Baileys para a zapo (sem novo QR Code).
 *
 * Uso:
 *   npm run migrar:zapo -- --simular            # só mostra o que seria migrado (não grava nada)
 *   npm run migrar:zapo                         # migra todas as sessões
 *   npm run migrar:zapo -- --sessao=<apikey>    # migra apenas uma sessão
 *
 * Observações:
 *  - Os dados da Baileys (tabela wa_session_keys) NÃO são apagados: servem de
 *    backup para voltar com WA_PROVIDER=baileys.
 *  - Não é obrigatório rodar este script: com WA_PROVIDER=zapo a API importa
 *    cada sessão automaticamente na primeira conexão. Ele serve para migrar
 *    tudo antes, conferir os resultados e detectar sessões problemáticas.
 *  - Pare a API (ou a sessão) antes de migrar para a Baileys não gravar chaves
 *    novas durante a cópia.
 */
import { execute } from "../src/config/database.js";
import { obterStoreZapo, encerrarStoreZapo } from "../src/providers/zapo/store.js";
import { importarSessaoBaileys } from "../src/providers/zapo/migrarCredenciais.js";

const args = process.argv.slice(2);
const simular = args.includes("--simular");
const sessaoUnica = args.find((a) => a.startsWith("--sessao="))?.split("=")[1];

async function principal() {
  const { rows } = sessaoUnica
    ? await execute(`SELECT apikey, nome_sessao FROM sessao WHERE apikey = $1`, [sessaoUnica])
    : await execute(`SELECT apikey, nome_sessao FROM sessao ORDER BY created_at`);

  console.log(`\n${simular ? "[SIMULAÇÃO] " : ""}Sessões encontradas: ${rows.length}\n`);

  const store = simular ? null : obterStoreZapo();
  const contagem = { importadas: 0, puladas: 0, simuladas: 0, erros: 0 };

  for (const { apikey, nome_sessao: nome } of rows) {
    const rotulo = `${nome || "(sem nome)"} [${apikey.slice(0, 8)}…]`;
    try {
      const r = await importarSessaoBaileys(apikey, store, { simular });
      if (r.importado) {
        contagem.importadas++;
        console.log(`✅ ${rotulo}: importada (${r.perdas?.length ?? 0} avisos de conversão)`);
      } else if (r.simulado) {
        contagem.simuladas++;
        console.log(`🔎 ${rotulo}: seria importada ${JSON.stringify(r.resumo)}`);
      } else {
        contagem.puladas++;
        console.log(`⏭️  ${rotulo}: pulada (${r.motivo})`);
      }
    } catch (erro) {
      contagem.erros++;
      console.log(`❌ ${rotulo}: ERRO - ${erro?.message || erro}`);
    }
  }

  console.log("\nResumo:", contagem);
  if (!simular && contagem.importadas > 0) {
    console.log("\nPróximo passo: defina WA_PROVIDER=zapo no .env e reinicie a API.");
  }
}

principal()
  .catch((erro) => {
    console.error("Falha na migração:", erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    await encerrarStoreZapo();
    process.exit();
  });
