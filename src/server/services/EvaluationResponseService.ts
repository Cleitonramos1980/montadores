import { v4 as uuid } from "uuid";
import { execDml, queryOne, queryRows } from "../db/db";
import { EvaluationLinkService } from "./EvaluationLinkService";
import { SacService } from "./SacService";

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
  ) {}

  async submit(token: string, submission: EvalSubmission): Promise<EvalResponseResult> {
    const linkInfo = await this.links.getByToken(token);
    if (!linkInfo) throw new Error("Link de avaliação inválido ou não encontrado.");
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

    const responseId = uuid();
    await execDml(
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
        orderId: null,
        assemblyJobId: null,
        numped: linkInfo.numped ?? null,
        codcli: null,
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

    // Store per-question answers
    for (const answer of submission.answers) {
      await execDml(
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

    // Mark link as used
    await this.links.markUsed(linkInfo.linkId);

    let sacTriggered = false;
    let sacCaseId: string | undefined;
    let paymentImpact: string | undefined;

    // SAC trigger on negative classification
    if (classification === "NEGATIVA" && linkInfo.numped) {
      try {
        const order = await queryOne<{ id: string; codcli: string }>(
          "SELECT ID, CODCLI FROM MONT_ORDERS WHERE NUMPED = :numped",
          { numped: linkInfo.numped },
        );
        if (order) {
          const sacResult = await this.sacService.open(
            order.id,
            `Avaliação negativa — fase ${linkInfo.phase}`,
            [
              `Score: ${score}/10`,
              submission.comment ? `Comentário: ${submission.comment}` : null,
            ].filter(Boolean).join("\n"),
          );
          sacCaseId = (sacResult as any)?.id;
          sacTriggered = true;

          // Record SAC reference in response
          await execDml(
            "UPDATE MONT_EVAL_RESPONSES SET SAC_TRIGGERED = 1, SAC_CASE_ID = :sacId WHERE ID = :id",
            { sacId: sacCaseId ?? null, id: responseId },
          );

          // Block payment if assembly phase
          if (linkInfo.phase === "MONTAGEM") {
            await execDml(
              `UPDATE MONT_PROVIDER_PAYMENTS SET STATUS = 'BLOQUEADO', BLOCKED_REASON = :reason, UPDATED_AT = SYSTIMESTAMP
               WHERE ASSEMBLY_JOB_ID IN (
                 SELECT ID FROM MONT_ASSEMBLY_JOBS WHERE ORDER_ID = :orderId
               ) AND STATUS NOT IN ('PAGO', 'CANCELADO')`,
              {
                reason: `Avaliação negativa (${score}/10). SAC aberto.`,
                orderId: order.id,
              },
            );
            paymentImpact = "BLOQUEADO";
            await execDml(
              "UPDATE MONT_EVAL_RESPONSES SET PAYMENT_IMPACT = 'BLOQUEADO' WHERE ID = :id",
              { id: responseId },
            );
          }
        }
      } catch {
        // SAC failure doesn't block evaluation recording
      }
    }

    // Auto-release payment on positive (assembly phase only)
    if (classification === "POSITIVA" && linkInfo.phase === "MONTAGEM" && linkInfo.numped) {
      try {
        const order = await queryOne<{ id: string }>(
          "SELECT ID FROM MONT_ORDERS WHERE NUMPED = :numped",
          { numped: linkInfo.numped },
        );
        if (order) {
          await execDml(
            `UPDATE MONT_PROVIDER_PAYMENTS SET STATUS = 'LIBERADO', UPDATED_AT = SYSTIMESTAMP
             WHERE ASSEMBLY_JOB_ID IN (
               SELECT ID FROM MONT_ASSEMBLY_JOBS WHERE ORDER_ID = :orderId
             ) AND STATUS = 'AGUARDANDO_AVALIACAO_CLIENTE'`,
            { orderId: order.id },
          );
          paymentImpact = "LIBERADO";
          await execDml(
            "UPDATE MONT_EVAL_RESPONSES SET PAYMENT_IMPACT = 'LIBERADO' WHERE ID = :id",
            { id: responseId },
          );
        }
      } catch {
        // payment update failure doesn't block evaluation
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
