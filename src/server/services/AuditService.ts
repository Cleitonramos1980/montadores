import { v4 as uuid } from "uuid";
import { execDml } from "../db/db";
import { json } from "../db/database";

export class AuditService {
  async log(input: {
    actorUserId?: string;
    action: string;
    entityType: string;
    entityId: string;
    previous?: unknown;
    next?: unknown;
    justification?: string;
    ip?: string;
    userAgent?: string;
  }) {
    const id = uuid();
    await execDml(
      `INSERT INTO MONT_AUDIT_LOGS
       (ID, ACTOR_USER_ID, ACTION, ENTITY_TYPE, ENTITY_ID, PREVIOUS_JSON, NEXT_JSON, JUSTIFICATION, IP, USER_AGENT)
       VALUES (:id, :actorUserId, :action, :entityType, :entityId, :previousJson, :nextJson, :justification, :ip, :userAgent)`,
      {
        id,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        previousJson: input.previous ? json(input.previous) : null,
        nextJson: input.next ? json(input.next) : null,
        justification: input.justification ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    );
    return id;
  }
}
