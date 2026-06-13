import { v4 as uuid } from "uuid";
import { execDml, queryOne, queryRows } from "../db/db";

export type EvalQuestionType = "SCALE" | "STARS" | "TEXT" | "SINGLE_CHOICE" | "YES_NO";

export type EvalQuestion = {
  id: string;
  configId: string;
  position: number;
  type: EvalQuestionType;
  label: string;
  required: boolean;
  minLabel: string | null;
  maxLabel: string | null;
  options: string[] | null;
  active: boolean;
};

export type EvalConfig = {
  id: string;
  phase: string;
  title: string;
  description: string | null;
  active: boolean;
  linkTtlDays: number;
  createdAt: Date | null;
  updatedAt: Date | null;
  questions?: EvalQuestion[];
};

export class EvaluationConfigService {
  async list(): Promise<EvalConfig[]> {
    const rows = await queryRows<any>(
      `SELECT ID, PHASE, TITLE, DESCRIPTION, ACTIVE, LINK_TTL_DAYS, CREATED_AT, UPDATED_AT
       FROM MONT_EVAL_CONFIGS
       ORDER BY PHASE`,
    );
    return rows.map(this._mapConfig);
  }

  async getById(id: string): Promise<EvalConfig | null> {
    const row = await queryOne<any>(
      `SELECT ID, PHASE, TITLE, DESCRIPTION, ACTIVE, LINK_TTL_DAYS, CREATED_AT, UPDATED_AT
       FROM MONT_EVAL_CONFIGS WHERE ID = :id`,
      { id },
    );
    if (!row) return null;
    const config = this._mapConfig(row);
    config.questions = await this._getQuestions(id);
    return config;
  }

  async getByPhase(phase: string): Promise<EvalConfig | null> {
    const row = await queryOne<any>(
      `SELECT ID, PHASE, TITLE, DESCRIPTION, ACTIVE, LINK_TTL_DAYS, CREATED_AT, UPDATED_AT
       FROM MONT_EVAL_CONFIGS WHERE PHASE = :phase`,
      { phase },
    );
    if (!row) return null;
    const config = this._mapConfig(row);
    config.questions = await this._getQuestions(config.id);
    return config;
  }

  async create(data: {
    phase: string;
    title: string;
    description?: string;
    linkTtlDays?: number;
    userId?: string;
  }): Promise<EvalConfig> {
    const existing = await queryOne<{ id: string }>(
      "SELECT ID FROM MONT_EVAL_CONFIGS WHERE PHASE = :phase",
      { phase: data.phase },
    );
    if (existing) throw new Error(`Já existe uma configuração para a fase ${data.phase}.`);

    const id = uuid();
    await execDml(
      `INSERT INTO MONT_EVAL_CONFIGS (ID, PHASE, TITLE, DESCRIPTION, ACTIVE, LINK_TTL_DAYS, CREATED_BY, UPDATED_BY)
       VALUES (:id, :phase, :title, :description, 1, :ttl, :userId, :userId)`,
      {
        id,
        phase: data.phase,
        title: data.title,
        description: data.description ?? null,
        ttl: data.linkTtlDays ?? 7,
        userId: data.userId ?? null,
      },
    );
    return (await this.getById(id))!;
  }

  async update(id: string, data: {
    title?: string;
    description?: string;
    linkTtlDays?: number;
    userId?: string;
  }): Promise<EvalConfig | null> {
    const existing = await queryOne<{ id: string }>(
      "SELECT ID FROM MONT_EVAL_CONFIGS WHERE ID = :id",
      { id },
    );
    if (!existing) return null;

    const sets: string[] = ["UPDATED_AT = SYSTIMESTAMP"];
    const binds: Record<string, unknown> = { id };
    if (data.title !== undefined)      { sets.push("TITLE = :title");               binds.title       = data.title; }
    if (data.description !== undefined){ sets.push("DESCRIPTION = :description");   binds.description = data.description ?? null; }
    if (data.linkTtlDays !== undefined){ sets.push("LINK_TTL_DAYS = :ttl");         binds.ttl         = data.linkTtlDays; }
    if (data.userId !== undefined)     { sets.push("UPDATED_BY = :userId");         binds.userId      = data.userId; }

    await execDml(`UPDATE MONT_EVAL_CONFIGS SET ${sets.join(", ")} WHERE ID = :id`, binds);
    return this.getById(id);
  }

  async toggleActive(id: string, active: boolean): Promise<boolean> {
    const row = await queryOne<{ id: string }>(
      "SELECT ID FROM MONT_EVAL_CONFIGS WHERE ID = :id",
      { id },
    );
    if (!row) return false;
    await execDml(
      "UPDATE MONT_EVAL_CONFIGS SET ACTIVE = :active, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { active: active ? 1 : 0, id },
    );
    return true;
  }

  // ── Questions ───────────────────────────────────────────────────────────────

  async addQuestion(configId: string, data: {
    type?: EvalQuestionType;
    label: string;
    required?: boolean;
    minLabel?: string;
    maxLabel?: string;
    options?: string[];
    position?: number;
  }): Promise<EvalQuestion> {
    const config = await queryOne<{ id: string }>(
      "SELECT ID FROM MONT_EVAL_CONFIGS WHERE ID = :id",
      { id: configId },
    );
    if (!config) throw new Error("Configuração de avaliação não encontrada.");

    const maxPos = await queryOne<{ mx: number }>(
      "SELECT MAX(POSITION) AS MX FROM MONT_EVAL_QUESTIONS WHERE CONFIG_ID = :configId AND ACTIVE = 1",
      { configId },
    );
    const position = data.position ?? (Number(maxPos?.mx ?? 0) + 1);

    const id = uuid();
    await execDml(
      `INSERT INTO MONT_EVAL_QUESTIONS
         (ID, CONFIG_ID, POSITION, TYPE, LABEL, REQUIRED, MIN_LABEL, MAX_LABEL, OPTIONS_JSON, ACTIVE)
       VALUES
         (:id, :configId, :position, :type, :label, :required, :minLabel, :maxLabel, :optionsJson, 1)`,
      {
        id,
        configId,
        position,
        type: data.type ?? "SCALE",
        label: data.label,
        required: data.required !== false ? 1 : 0,
        minLabel: data.minLabel ?? null,
        maxLabel: data.maxLabel ?? null,
        optionsJson: data.options ? JSON.stringify(data.options) : null,
      },
    );
    return this._mapQuestion((await queryOne<any>(
      "SELECT * FROM MONT_EVAL_QUESTIONS WHERE ID = :id",
      { id },
    ))!);
  }

  async updateQuestion(questionId: string, data: {
    label?: string;
    required?: boolean;
    minLabel?: string;
    maxLabel?: string;
    options?: string[];
    position?: number;
  }): Promise<boolean> {
    const row = await queryOne<{ id: string }>(
      "SELECT ID FROM MONT_EVAL_QUESTIONS WHERE ID = :id AND ACTIVE = 1",
      { id: questionId },
    );
    if (!row) return false;

    const sets: string[] = [];
    const binds: Record<string, unknown> = { id: questionId };
    if (data.label !== undefined)    { sets.push("LABEL = :label");              binds.label     = data.label; }
    if (data.required !== undefined) { sets.push("REQUIRED = :required");        binds.required  = data.required ? 1 : 0; }
    if (data.minLabel !== undefined) { sets.push("MIN_LABEL = :minLabel");       binds.minLabel  = data.minLabel ?? null; }
    if (data.maxLabel !== undefined) { sets.push("MAX_LABEL = :maxLabel");       binds.maxLabel  = data.maxLabel ?? null; }
    if (data.options !== undefined)  { sets.push("OPTIONS_JSON = :optionsJson"); binds.optionsJson = data.options ? JSON.stringify(data.options) : null; }
    if (data.position !== undefined) { sets.push("POSITION = :position");        binds.position  = data.position; }

    if (sets.length === 0) return true;
    await execDml(`UPDATE MONT_EVAL_QUESTIONS SET ${sets.join(", ")} WHERE ID = :id`, binds);
    return true;
  }

  async deleteQuestion(questionId: string): Promise<boolean> {
    const row = await queryOne<{ id: string }>(
      "SELECT ID FROM MONT_EVAL_QUESTIONS WHERE ID = :id AND ACTIVE = 1",
      { id: questionId },
    );
    if (!row) return false;
    await execDml(
      "UPDATE MONT_EVAL_QUESTIONS SET ACTIVE = 0 WHERE ID = :id",
      { id: questionId },
    );
    return true;
  }

  // ── private helpers ─────────────────────────────────────────────────────────

  private async _getQuestions(configId: string): Promise<EvalQuestion[]> {
    const rows = await queryRows<any>(
      `SELECT ID, CONFIG_ID, POSITION, TYPE, LABEL, REQUIRED, MIN_LABEL, MAX_LABEL, OPTIONS_JSON, ACTIVE
       FROM MONT_EVAL_QUESTIONS WHERE CONFIG_ID = :configId AND ACTIVE = 1
       ORDER BY POSITION`,
      { configId },
    );
    return rows.map(this._mapQuestion);
  }

  private _mapConfig(row: any): EvalConfig {
    return {
      id: row.id as string,
      phase: row.phase as string,
      title: row.title as string,
      description: (row.description as string | null) ?? null,
      active: Number(row.active) === 1,
      linkTtlDays: Number(row.link_ttl_days ?? 7),
      createdAt: row.created_at ? new Date(row.created_at as string) : null,
      updatedAt: row.updated_at ? new Date(row.updated_at as string) : null,
    };
  }

  private _mapQuestion(row: any): EvalQuestion {
    let options: string[] | null = null;
    try { options = row.options_json ? JSON.parse(row.options_json as string) : null; } catch { /* */ }
    return {
      id: row.id as string,
      configId: row.config_id as string,
      position: Number(row.position),
      type: (row.type as EvalQuestionType) ?? "SCALE",
      label: row.label as string,
      required: Number(row.required) === 1,
      minLabel: (row.min_label as string | null) ?? null,
      maxLabel: (row.max_label as string | null) ?? null,
      options,
      active: Number(row.active) === 1,
    };
  }
}
