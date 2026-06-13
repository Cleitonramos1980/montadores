import * as XLSX from "xlsx";

function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  try { return new Date(d).toLocaleDateString("pt-BR"); } catch { return String(d); }
}

const PHASE_LABEL: Record<string, string> = {
  ATENDIMENTO: "Atendimento",
  ENTREGA:     "Entrega",
  MONTAGEM:    "Montagem",
};

// ── Reviews (individual evaluations) ────────────────────────────────────────

export function exportReviewsXlsx(reviews: any[], filename: string) {
  const rows = reviews.map((r) => ({
    Pedido:          r.numped ?? "",
    Cliente:         r.customer_name ?? "",
    Montador:        r.provider_name ?? "",
    Fase:            PHASE_LABEL[r.service_type ?? r.phase ?? ""] ?? (r.service_type ?? r.phase ?? ""),
    Nota:            r.score != null ? Number(r.score) : "",
    Classificação:   r.classification ?? "",
    Comentário:      r.review_comment ?? r.eval_comment ?? r.comment ?? "",
    Data:            fmtDate(r.created_at),
  }));

  const ws = XLSX.utils.json_to_sheet(rows);

  // Column widths
  ws["!cols"] = [
    { wch: 12 }, { wch: 28 }, { wch: 28 }, { wch: 14 },
    { wch: 8 },  { wch: 14 }, { wch: 50 }, { wch: 14 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Avaliações");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// ── Analytics (per-question distribution) ────────────────────────────────────

type AnswerDist  = { value: string; count: number; pct: number };
type QuestionStat = {
  questionId: string; label: string; type: string; position: number;
  minLabel: string | null; maxLabel: string | null;
  totalAnswered: number; distribution: AnswerDist[]; textSamples?: string[];
};
type PhaseAnalytics = { phase: string; totalResponses: number; questions: QuestionStat[] };

export function exportAnalyticsXlsx(analytics: PhaseAnalytics, reviews: any[], filename: string) {
  const wb = XLSX.utils.book_new();

  // Sheet 1 — Summary per question
  const summaryRows: Record<string, string | number>[] = [];
  for (const q of analytics.questions) {
    const typeLabel: Record<string, string> = {
      SCALE: "Escala 0-10", STARS: "Estrelas 1-5",
      YES_NO: "Sim/Não", SINGLE_CHOICE: "Múltipla escolha", TEXT: "Texto livre",
    };
    for (const d of q.distribution) {
      summaryRows.push({
        "#": q.position,
        Pergunta:   q.label,
        Tipo:       typeLabel[q.type] ?? q.type,
        Resposta:   d.value,
        Quantidade: d.count,
        "%":        d.pct,
        "Total responderam": q.totalAnswered,
      });
    }
    // Add text samples
    if (q.type === "TEXT" && q.textSamples?.length) {
      for (const t of q.textSamples) {
        summaryRows.push({
          "#": q.position,
          Pergunta:   q.label,
          Tipo:       "Texto livre",
          Resposta:   t,
          Quantidade: 1,
          "%":        "",
          "Total responderam": q.totalAnswered,
        });
      }
    }
  }

  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  wsSummary["!cols"] = [
    { wch: 4 }, { wch: 45 }, { wch: 18 }, { wch: 30 }, { wch: 12 }, { wch: 8 }, { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, "Respostas por Pergunta");

  // Sheet 2 — Individual reviews
  if (reviews.length > 0) {
    const revRows = reviews.map((r) => ({
      Pedido:        r.numped ?? "",
      Cliente:       r.customer_name ?? "",
      Montador:      r.provider_name ?? "",
      Nota:          r.score != null ? Number(r.score) : "",
      Classificação: r.classification ?? "",
      Comentário:    r.review_comment ?? r.eval_comment ?? r.comment ?? "",
      Data:          fmtDate(r.created_at),
    }));
    const wsRev = XLSX.utils.json_to_sheet(revRows);
    wsRev["!cols"] = [
      { wch: 12 }, { wch: 28 }, { wch: 28 }, { wch: 8 }, { wch: 14 }, { wch: 50 }, { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(wb, wsRev, "Avaliações Individuais");
  }

  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// ── Consolidated (all phases merged) ─────────────────────────────────────────

export function exportConsolidatedXlsx(
  reviews: any[],
  filter: string,
  filename: string,
) {
  const filtered = filter === "all" ? reviews : reviews.filter((r) => r.classification === filter);

  const rows = filtered.map((r) => ({
    Pedido:        r.numped ?? "",
    Cliente:       r.customer_name ?? "",
    Montador:      r.provider_name ?? "",
    Fase:          PHASE_LABEL[r.service_type ?? r.phase ?? ""] ?? "",
    Nota:          r.score != null ? Number(r.score) : "",
    Classificação: r.classification ?? "",
    Comentário:    r.review_comment ?? r.eval_comment ?? r.comment ?? "",
    Data:          fmtDate(r.created_at),
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 12 }, { wch: 28 }, { wch: 28 }, { wch: 14 },
    { wch: 8 },  { wch: 14 }, { wch: 50 }, { wch: 14 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Relatório Consolidado");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
