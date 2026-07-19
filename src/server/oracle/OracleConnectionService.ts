// DESCONTINUADO — código morto (nenhum módulo importa este arquivo).
// Este serviço criava um 2º pool Oracle SEM callTimeout, divergindo do pool
// canônico em src/server/db/oracle.ts (que aplica callTimeout e poolAlias).
// Se precisar acessar o Oracle, use executeOracle / withOracleConnection de
// "../db/oracle". Mantido apenas como stub para não quebrar histórico.
export {};
