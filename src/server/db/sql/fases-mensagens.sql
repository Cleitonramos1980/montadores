-- =====================================================================
-- App Montadores — Templates e configuração das fases de mensagem
-- Gerado a partir do estado real do banco. Idempotente (MERGE).
-- Tabelas: MONT_MSG_TEMPLATES, MONT_FLUXO_EVENT_CONFIG
-- =====================================================================

-- ---------------------------------------------------------------------
-- EM_SEPARACAO_CONFERENCIA
-- ---------------------------------------------------------------------
MERGE INTO MONT_MSG_TEMPLATES t USING DUAL ON (UPPER(t.EVENT_TYPE) = 'EM_SEPARACAO_CONFERENCIA')
WHEN MATCHED THEN UPDATE SET
  SUBJECT = 'Pedido {{numped}} em separação',
  BODY = 'Boas notícias, {{cliente}}! Seu pedido *#{{numped}}* está sendo separado e conferido no nosso estoque.

Em breve ele será faturado e despachado para você.

Acompanhe: {{link_jornada}}',
  ACTIVE = 1,
  SEND_HOUR_START = 8, SEND_HOUR_END = 21,
  RESEND_ALLOWED = 0, MAX_RESENDS = 0, RESEND_AFTER_H = NULL
WHEN NOT MATCHED THEN INSERT
  (ID, EVENT_TYPE, CHANNEL, RECIPIENT, SUBJECT, BODY, ACTIVE, SEND_HOUR_START, SEND_HOUR_END, RESEND_ALLOWED, MAX_RESENDS, RESEND_AFTER_H)
  VALUES (SYS_GUID(), 'EM_SEPARACAO_CONFERENCIA', 'WHATSAPP', 'CLIENTE', 'Pedido {{numped}} em separação', 'Boas notícias, {{cliente}}! Seu pedido *#{{numped}}* está sendo separado e conferido no nosso estoque.

Em breve ele será faturado e despachado para você.

Acompanhe: {{link_jornada}}', 1, 8, 21, 0, 0, NULL);

MERGE INTO MONT_FLUXO_EVENT_CONFIG c USING DUAL ON (c.EVENT_KEY = 'EM_SEPARACAO_CONFERENCIA')
WHEN MATCHED THEN UPDATE SET
  ATIVO_MENSAGEM = 1, MODO_ENVIO = 'HOMOLOGACAO', TELEFONES_TESTE = '5592982800005', ATUALIZADO_EM = SYSTIMESTAMP
WHEN NOT MATCHED THEN INSERT
  (EVENT_KEY, LABEL, ATIVO_DASHBOARD, ATIVO_MENSAGEM, MODO_ENVIO, TELEFONES_TESTE, ATUALIZADO_EM)
  VALUES ('EM_SEPARACAO_CONFERENCIA', '3 - Em Separação / Conferência', 1, 1, 'HOMOLOGACAO', '5592982800005', SYSTIMESTAMP);

-- ---------------------------------------------------------------------
-- SEPARACAO_INICIADA
-- ---------------------------------------------------------------------
MERGE INTO MONT_MSG_TEMPLATES t USING DUAL ON (UPPER(t.EVENT_TYPE) = 'SEPARACAO_INICIADA')
WHEN MATCHED THEN UPDATE SET
  SUBJECT = 'Pedido {{numped}} em separação',
  BODY = 'Olá, {{cliente}}! ¿ Seu pedido *#{{numped}}* já está sendo separado no nosso estoque.

Em breve ele será conferido e despachado para você.

Acompanhe: {{link_jornada}}',
  ACTIVE = 1,
  SEND_HOUR_START = 8, SEND_HOUR_END = 21,
  RESEND_ALLOWED = 0, MAX_RESENDS = 0, RESEND_AFTER_H = NULL
WHEN NOT MATCHED THEN INSERT
  (ID, EVENT_TYPE, CHANNEL, RECIPIENT, SUBJECT, BODY, ACTIVE, SEND_HOUR_START, SEND_HOUR_END, RESEND_ALLOWED, MAX_RESENDS, RESEND_AFTER_H)
  VALUES (SYS_GUID(), 'SEPARACAO_INICIADA', 'WHATSAPP', 'CLIENTE', 'Pedido {{numped}} em separação', 'Olá, {{cliente}}! ¿ Seu pedido *#{{numped}}* já está sendo separado no nosso estoque.

Em breve ele será conferido e despachado para você.

Acompanhe: {{link_jornada}}', 1, 8, 21, 0, 0, NULL);

MERGE INTO MONT_FLUXO_EVENT_CONFIG c USING DUAL ON (c.EVENT_KEY = 'SEPARACAO_INICIADA')
WHEN MATCHED THEN UPDATE SET
  ATIVO_MENSAGEM = 0, MODO_ENVIO = 'DRY_RUN', TELEFONES_TESTE = NULL, ATUALIZADO_EM = SYSTIMESTAMP
WHEN NOT MATCHED THEN INSERT
  (EVENT_KEY, LABEL, ATIVO_DASHBOARD, ATIVO_MENSAGEM, MODO_ENVIO, TELEFONES_TESTE, ATUALIZADO_EM)
  VALUES ('SEPARACAO_INICIADA', 'Separação Iniciada', 1, 0, 'DRY_RUN', NULL, SYSTIMESTAMP);

-- ---------------------------------------------------------------------
-- CONFERENCIA_FINALIZADA
-- ---------------------------------------------------------------------
MERGE INTO MONT_MSG_TEMPLATES t USING DUAL ON (UPPER(t.EVENT_TYPE) = 'CONFERENCIA_FINALIZADA')
WHEN MATCHED THEN UPDATE SET
  SUBJECT = 'Pedido {{numped}} conferido e pronto',
  BODY = 'Uhuul, {{cliente}}! ¿ Seu pedido *#{{numped}}* foi conferido e está pronto para expedição.

Acompanhe: {{link_jornada}}',
  ACTIVE = 1,
  SEND_HOUR_START = 8, SEND_HOUR_END = 21,
  RESEND_ALLOWED = 0, MAX_RESENDS = 0, RESEND_AFTER_H = NULL
WHEN NOT MATCHED THEN INSERT
  (ID, EVENT_TYPE, CHANNEL, RECIPIENT, SUBJECT, BODY, ACTIVE, SEND_HOUR_START, SEND_HOUR_END, RESEND_ALLOWED, MAX_RESENDS, RESEND_AFTER_H)
  VALUES (SYS_GUID(), 'CONFERENCIA_FINALIZADA', 'WHATSAPP', 'CLIENTE', 'Pedido {{numped}} conferido e pronto', 'Uhuul, {{cliente}}! ¿ Seu pedido *#{{numped}}* foi conferido e está pronto para expedição.

Acompanhe: {{link_jornada}}', 1, 8, 21, 0, 0, NULL);

MERGE INTO MONT_FLUXO_EVENT_CONFIG c USING DUAL ON (c.EVENT_KEY = 'CONFERENCIA_FINALIZADA')
WHEN MATCHED THEN UPDATE SET
  ATIVO_MENSAGEM = 0, MODO_ENVIO = 'DRY_RUN', TELEFONES_TESTE = NULL, ATUALIZADO_EM = SYSTIMESTAMP
WHEN NOT MATCHED THEN INSERT
  (EVENT_KEY, LABEL, ATIVO_DASHBOARD, ATIVO_MENSAGEM, MODO_ENVIO, TELEFONES_TESTE, ATUALIZADO_EM)
  VALUES ('CONFERENCIA_FINALIZADA', 'Conferência Finalizada', 1, 0, 'DRY_RUN', NULL, SYSTIMESTAMP);

-- ---------------------------------------------------------------------
-- CONFERIDO_AGUARDANDO_FATURAMENTO
-- ---------------------------------------------------------------------
MERGE INTO MONT_MSG_TEMPLATES t USING DUAL ON (UPPER(t.EVENT_TYPE) = 'CONFERIDO_AGUARDANDO_FATURAMENTO')
WHEN MATCHED THEN UPDATE SET
  SUBJECT = 'Pedido {{numped}} conferido',
  BODY = 'Olá, {{cliente}}! Seu pedido *#{{numped}}* foi conferido com sucesso e está aguardando a emissão da nota fiscal.

Estamos quase lá! Você receberá um aviso assim que sair para entrega.

Acompanhe: {{link_jornada}}',
  ACTIVE = 1,
  SEND_HOUR_START = 8, SEND_HOUR_END = 21,
  RESEND_ALLOWED = 0, MAX_RESENDS = 0, RESEND_AFTER_H = NULL
WHEN NOT MATCHED THEN INSERT
  (ID, EVENT_TYPE, CHANNEL, RECIPIENT, SUBJECT, BODY, ACTIVE, SEND_HOUR_START, SEND_HOUR_END, RESEND_ALLOWED, MAX_RESENDS, RESEND_AFTER_H)
  VALUES (SYS_GUID(), 'CONFERIDO_AGUARDANDO_FATURAMENTO', 'WHATSAPP', 'CLIENTE', 'Pedido {{numped}} conferido', 'Olá, {{cliente}}! Seu pedido *#{{numped}}* foi conferido com sucesso e está aguardando a emissão da nota fiscal.

Estamos quase lá! Você receberá um aviso assim que sair para entrega.

Acompanhe: {{link_jornada}}', 1, 8, 21, 0, 0, NULL);

MERGE INTO MONT_FLUXO_EVENT_CONFIG c USING DUAL ON (c.EVENT_KEY = 'CONFERIDO_AGUARDANDO_FATURAMENTO')
WHEN MATCHED THEN UPDATE SET
  ATIVO_MENSAGEM = 1, MODO_ENVIO = 'HOMOLOGACAO', TELEFONES_TESTE = '5592982800005', ATUALIZADO_EM = SYSTIMESTAMP
WHEN NOT MATCHED THEN INSERT
  (EVENT_KEY, LABEL, ATIVO_DASHBOARD, ATIVO_MENSAGEM, MODO_ENVIO, TELEFONES_TESTE, ATUALIZADO_EM)
  VALUES ('CONFERIDO_AGUARDANDO_FATURAMENTO', '4 - Conferido / Aguardando Faturamento', 1, 1, 'HOMOLOGACAO', '5592982800005', SYSTIMESTAMP);

-- ---------------------------------------------------------------------
-- FATURADO_AGUARDANDO_SAIDA
-- ---------------------------------------------------------------------
MERGE INTO MONT_MSG_TEMPLATES t USING DUAL ON (UPPER(t.EVENT_TYPE) = 'FATURADO_AGUARDANDO_SAIDA')
WHEN MATCHED THEN UPDATE SET
  SUBJECT = 'Nota fiscal emitida — pedido {{numped}}',
  BODY = 'Olá, {{cliente}}! A nota fiscal do pedido *#{{numped}}* foi emitida.

Seu pedido está pronto e aguardando carregamento. Assim que sair para entrega, você será avisado.

Acompanhe: {{link_jornada}}',
  ACTIVE = 1,
  SEND_HOUR_START = 8, SEND_HOUR_END = 21,
  RESEND_ALLOWED = 0, MAX_RESENDS = 0, RESEND_AFTER_H = NULL
WHEN NOT MATCHED THEN INSERT
  (ID, EVENT_TYPE, CHANNEL, RECIPIENT, SUBJECT, BODY, ACTIVE, SEND_HOUR_START, SEND_HOUR_END, RESEND_ALLOWED, MAX_RESENDS, RESEND_AFTER_H)
  VALUES (SYS_GUID(), 'FATURADO_AGUARDANDO_SAIDA', 'WHATSAPP', 'CLIENTE', 'Nota fiscal emitida — pedido {{numped}}', 'Olá, {{cliente}}! A nota fiscal do pedido *#{{numped}}* foi emitida.

Seu pedido está pronto e aguardando carregamento. Assim que sair para entrega, você será avisado.

Acompanhe: {{link_jornada}}', 1, 8, 21, 0, 0, NULL);

MERGE INTO MONT_FLUXO_EVENT_CONFIG c USING DUAL ON (c.EVENT_KEY = 'FATURADO_AGUARDANDO_SAIDA')
WHEN MATCHED THEN UPDATE SET
  ATIVO_MENSAGEM = 1, MODO_ENVIO = 'HOMOLOGACAO', TELEFONES_TESTE = '5592982800005', ATUALIZADO_EM = SYSTIMESTAMP
WHEN NOT MATCHED THEN INSERT
  (EVENT_KEY, LABEL, ATIVO_DASHBOARD, ATIVO_MENSAGEM, MODO_ENVIO, TELEFONES_TESTE, ATUALIZADO_EM)
  VALUES ('FATURADO_AGUARDANDO_SAIDA', '5 - Faturado / Aguardando Saída', 1, 1, 'HOMOLOGACAO', '5592982800005', SYSTIMESTAMP);

COMMIT;
