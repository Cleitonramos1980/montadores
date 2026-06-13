import { v4 as uuid } from "uuid";
import { execDml } from "../db/db";

export class IntegrationLogService {
  async record(input: {
    syncType: string;
    numped?: string;
    codcli?: string;
    queryName: string;
    status: "SUCESSO" | "ERRO";
    errorMessage?: string;
    elapsedMs: number;
    origin: string;
    userId?: string;
  }) {
    await execDml(
      `INSERT INTO MONT_WINTHOR_SYNC_LOGS
       (ID, SYNC_TYPE, NUMPED, CODCLI, QUERY_NAME, STATUS, ERROR_MESSAGE, ELAPSED_MS, ORIGIN, USER_ID)
       VALUES (:id, :syncType, :numped, :codcli, :queryName, :status, :errorMessage, :elapsedMs, :origin, :userId)`,
      {
        id: uuid(),
        syncType: input.syncType,
        numped: input.numped ?? null,
        codcli: input.codcli ?? null,
        queryName: input.queryName,
        status: input.status,
        errorMessage: input.errorMessage ?? null,
        elapsedMs: input.elapsedMs,
        origin: input.origin,
        userId: input.userId ?? null,
      },
    );

    if (input.status === "ERRO") {
      await execDml(
        `INSERT INTO MONT_INTEGRATION_FAILURES (ID, SOURCE, OPERATION, REFERENCE, ERROR_MESSAGE)
         VALUES (:id, 'WINTHOR', :operation, :reference, :errorMessage)`,
        {
          id: uuid(),
          operation: input.queryName,
          reference: input.numped ?? input.codcli ?? null,
          errorMessage: input.errorMessage ?? "Erro desconhecido",
        },
      );
    }
  }
}
