export type AssemblyStatus = "AGENDADA" | "EM_EXECUCAO" | "FINALIZADA" | "CANCELADA";

const TRANSITIONS: Record<AssemblyStatus, readonly AssemblyStatus[]> = {
  AGENDADA:    ["EM_EXECUCAO", "CANCELADA"],
  EM_EXECUCAO: ["FINALIZADA", "CANCELADA"],
  FINALIZADA:  [],
  CANCELADA:   [],
};

const STATUS_LABELS: Record<AssemblyStatus, string> = {
  AGENDADA:    "Agendada",
  EM_EXECUCAO: "Em Execução",
  FINALIZADA:  "Finalizada",
  CANCELADA:   "Cancelada",
};

const ACTION_VERB: Partial<Record<AssemblyStatus, string>> = {
  EM_EXECUCAO: "iniciar",
  FINALIZADA:  "finalizar",
  CANCELADA:   "cancelar",
};

export function assertTransition(from: AssemblyStatus, to: AssemblyStatus): void {
  const allowed = TRANSITIONS[from] ?? ([] as readonly AssemblyStatus[]);
  if (!allowed.includes(to)) {
    const verb = ACTION_VERB[to] ?? `transicionar para ${to}`;
    const allowedStr = (allowed as readonly AssemblyStatus[])
      .map((s) => STATUS_LABELS[s])
      .join(", ");
    throw new Error(
      `Não é possível ${verb} montagem com status '${STATUS_LABELS[from]}'. ` +
      (allowedStr
        ? `Transições permitidas: ${allowedStr}.`
        : `Status '${STATUS_LABELS[from]}' é terminal — nenhuma transição possível.`),
    );
  }
}

export function canTransition(from: AssemblyStatus, to: AssemblyStatus): boolean {
  return (TRANSITIONS[from] ?? ([] as readonly AssemblyStatus[])).includes(to);
}
