import { v4 as uuid } from "uuid";
import { logger } from "../logger";
import { AppError } from "../errors";
import { execDml, queryOne, queryRows, withTransaction } from "../db/db";
import { EvaluationLinkService } from "./EvaluationLinkService";
import { SacService } from "./SacService";
import { WinthorSyncService } from "./WinthorSyncService";

export type EvalAnswer = {
  questionId: string;
  valueText?: string;
  valueNumber?: number;
};

export type EvalSubmission = {
  answers: EvalAnswer[];
  comment?: string;
  ip?: string;
  userAgent?: string;
};

export type EvalResponseResult = {
  responseId: string;
  score: number;
  classification: "POSITIVA" | "NEUTRA" | "NEGATIVA";
  sacTriggered: boolean;
  sacCaseId?: string;
  paymentImpact?: string;
};

export class EvaluationResponseService {
  constructor(
    private readonly links = new EvaluationLinkService(),
    private readonly sacService = new SacService(),
    private readonly winthorSync = new WinthorSyncService(),
  ) {}

  async submit(token: string, submission: EvalSubmission): Promise<EvalResponseResult> {
    const linkInfo = await this.links.getByToken(token);
    if (!linkInfo) throw new AppError("Link de avaliação inválido ou não encontrado.", 404, "NOT_FOUND");
    if (linkInfo.usedAt) throw new Error("Esta avaliação já foi respondida.");
    if (new Date() > linkInfo.expiresAt) throw new Error("Este link de avaliação expirou.");

    // Calculate score from numeric answers (average of SCALE/STARS questions, normalized to 0-10)
    const numericAnswers = submission.answers.filter((a) => a.valueNumber !== undefined);
    let score = 0;
    if (numericAnswers.length > 0) {
      const questions = linkInfo.config.questions.filter(
        (q) => q.type === "SCALE" || q.type === "STARS",
      );
      const answeredNums = submission.answers
        .filter((a) => a.valueNumber !== undefined)
        .map((a) => {
          const q = questions.find((q) => q.id === a.questionId);
          if (!q) return a.valueNumber!;
          // STARS: typically 1-5, normalize to 0-10
          if (q.type === "STARS") return ((a.valueNumber! - 1) / 4) * 10;
          // SCALE: assume already 0-10
          return a.valueNumber!;
        });
      score = answeredNums.reduce((s, v) => s + v, 0) / answeredNums.length;
      score = Math.round(score * 10) / 10;
    }

    const classification: "POSITIVA" | "NEUTRA" | "NEGATIVA" =
      score >= 9 ? "POSITIVA" : score >= 7 ? "NEUTRA" : "NEGATIVA";

    // Resolve MONT_ORDERS record BEFORE INSERT so ORDER_ID is populated correctly.
    // If the order isn't synced yet, trigger WinThor sync on the fly.
    let montOrder: { id: string; codcli: string } | null = null;
    if (linkInfo.numped) {
      // Sem .catch(()=>null): queryOne já retorna null para "sem linhas"; um ERRO de
      // banco deve propagar (senão o antifraude/bloqueio de pagamento seria pulado em
      // silêncio e a avaliação retornaria 200 como se estivesse tudo certo).
      montOrder = await queryOne<{ id: string; codcli: string }>(
        "SELECT ID, CODCLI FROM MONT_ORDERS WHERE NUMPED = :numped",
        { numped: linkInfo.numped },
      );

      if (!montOrder) {
        try {
          await this.winthorSync.syncOrder(linkInfo.numped);
          montOrder = await queryOne<{ id: string; codcli: string }>(
            "SELECT ID, CODCLI FROM MONT_ORDERS WHERE NUMPED = :numped",
            { numped: linkInfo.numped },
          );
        } catch (err) {
          logger.warn({ err: (err as Error).message, numped: linkInfo.numped }, "[eval] sync WinThor on-the-fly falhou; SAC/bloqueio podem não ser criados");
        }
      }
    }

    const responseId = uuid();
    // Atômico: a resposta e todas as respostas de perguntas gravam juntas ou nada,
    // evitando uma resposta órfã sem answers se falhar no meio do loop.
    await withTransaction(async (tx) => {
      await tx.exec(
        `INSERT INTO MONT_EVAL_RESPONSES
           (ID, LINK_ID, CONFIG_ID, ORDER_ID, ASSEMBLY_JOB_ID, NUMPED, CODCLI, PHASE,
            SCORE, CLASSIFICATION, EVAL_COMMENT, SAC_TRIGGERED, PAYMENT_IMPACT, IP, USER_AGENT)
         VALUES
           (:id, :linkId, :configId, :orderId, :assemblyJobId, :numped, :codcli, :phase,
            :score, :classification, :evalComment, :sacTriggered, :paymentImpact, :ip, :userAgent)`,
        {
          id: responseId,
          linkId: linkInfo.linkId,
          configId: linkInfo.configId,
          orderId: montOrder?.id ?? null,
          assemblyJobId: null,
          numped: linkInfo.numped ?? null,
          codcli: montOrder?.codcli ?? null,
          phase: linkInfo.phase,
          score,
          classification,
          evalComment: submission.comment ?? null,
          sacTriggered: 0,
          paymentImpact: null,
          ip: submission.ip ?? null,
          userAgent: submission.userAgent ?? null,
        },
      );
      for (const answer of submission.answers) {
        await tx.exec(
          `INSERT INTO MONT_EVAL_ANSWERS (ID, RESPONSE_ID, QUESTION_ID, VALUE_TEXT, VALUE_NUMBER)
           VALUES (:id, :responseId, :questionId, :valueText, :valueNumber)`,
          {
            id: uuid(),
            responseId,
            questionId: answer.questionId,
            valueText: answer.valueText ?? null,
            valueNumber: answer.valueNumber ?? null,
          },
        );
      }
    });

    // Mark link as used
    await this.links.markUsed(linkInfo.linkId);

    let sacTriggered = false;
    let sacCaseId: string | undefined;
    let paymentImpact: string | undefined;

    // SAC trigger on negative classification — requires order in MONT_ORDERS
    if (classification === "NEGATIVA" && montOrder) {
      // Abre o SAC. Falha aqui não deve impedir o bloqueio de pagamento abaixo.
      try {
        const sacResult = await this.sacService.open(
          montOrder.id,
          `Avaliação negativa — fase ${linkInfo.phase}`,
          [
            `Score: ${score}/10`,
            submission.comment ? `Comentário: ${submission.comment}` : null,
          ].filter(Boolean).join("\n"),
        );
        sacCaseId = sacResult?.id;
        sacTriggered = true;
      } catch (err) {
        logger.error({ err: (err as Error).message, orderId: montOrder.id }, "[eval] falha ao abrir SAC");
      }

      // Persiste o vínculo do SAC (não-crítico e isolado — coluna pode não existir em bases antigas).
      try {
        await execDml(
          "UPDATE MONT_EVAL_RESPONSES SET SAC_TRIGGERED = :trig, SAC_CASE_ID = :sacId WHERE ID = :id",
          { trig: sacTriggered ? 1 : 0, sacId: sacCaseId ?? null, id: responseId },
        );
      } catch (err) {
        logger.error({ err: (err as Error).message, responseId }, "[eval] falha ao gravar SAC_CASE_ID");
      }

      // Bloqueio de pagamento em fase de montagem — CRÍTICO, roda independente do SAC.
      if (linkInfo.phase === "MONTAGEM") {
        try {
          await execDml(
            `UPDATE MONT_PROVIDER_PAYMENTS SET STATUS = 'BLOQUEADO', BLOCKED_REASON = :reason, UPDATED_AT = SYSTIMESTAMP
             WHERE ASSEMBLY_JOB_ID IN (
               SELECT ID FROM MONT_ASSEMBLY_JOBS WHERE ORDER_ID = :orderId
             ) AND STATUS NOT IN ('PAGO', 'CANCELADO')`,
            { reason: `Avaliação negativa (${score}/10). SAC aberto.`, orderId: montOrder.id },
          );
          paymentImpact = "BLOQUEADO";
          await execDml(
            "UPDATE MONT_EVAL_RESPONSES SET PAYMENT_IMPACT = 'BLOQUEADO' WHERE ID = :id",
            { id: responseId },
          );
        } catch (err) {
          logger.error({ err: (err as Error).message, orderId: montOrder.id }, "[eval] falha ao bloquear pagamento (avaliação negativa)");
        }
      }
    }

    // Auto-release payment on positive (assembly phase only).
    // NÃO libera se houver SAC aberto para o job (mesma trava do PaymentService.release,
    // que este UPDATE direto antes ignorava). Falha é logada, nunca engolida em silêncio.
    if (classification === "POSITIVA" && linkInfo.phase === "MONTAGEM" && montOrder) {
      try {
        await execDml(
          `UPDATE MONT_PROVIDER_PAYMENTS p SET p.STATUS = 'LIBERADO', p.UPDATED_AT = SYSTIMESTAMP
           WHERE p.ASSEMBLY_JOB_ID IN (
             SELECT ID FROM MONT_ASSEMBLY_JOBS WHERE ORDER_ID = :orderId
           ) AND p.STATUS = 'AGUARDANDO_AVALIACAO_CLIENTE'
           AND NOT EXISTS (
             SELECT 1 FROM MONT_SAC_CASES sc
             WHERE sc.ASSEMBLY_JOB_ID = p.ASSEMBLY_JOB_ID
               AND sc.STATUS NOT IN ('RESOLVIDO','ENCERRADO','CANCELADO')
           )`,
          { orderId: montOrder.id },
        );
        paymentImpact = "LIBERADO";
        await execDml(
          "UPDATE MONT_EVAL_RESPONSES SET PAYMENT_IMPACT = 'LIBERADO' WHERE ID = :id",
          { id: responseId },
        );
      } catch (err) {
        logger.error({ err: (err as Error).message, orderId: montOrder.id }, "[eval] falha ao liberar pagamento em avaliação positiva");
      }
    }

    return { responseId, score, classification, sacTriggered, sacCaseId, paymentImpact };
  }

  async listByPhase(phase: string, page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize;
    const [rows, countRow] = await Promise.all([
      queryRows<unknown>(
        `SELECT ID, NUMPED, PHASE, SCORE, CLASSIFICATION, EVAL_COMMENT,
                SAC_TRIGGERED, PAYMENT_IMPACT, CREATED_AT
         FROM MONT_EVAL_RESPONSES
         WHERE PHASE = :phase
         ORDER BY CREATED_AT DESC
         OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
        { phase, offset, pageSize },
      ),
      queryOne<{ total: number }>(
        "SELECT COUNT(*) AS TOTAL FROM MONT_EVAL_RESPONSES WHERE PHASE = :phase",
        { phase },
      ),
    ]);
    return { rows, total: Number(countRow?.total ?? 0), page, pageSize };
  }
}
