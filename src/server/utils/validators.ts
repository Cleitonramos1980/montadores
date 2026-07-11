import { z } from "zod";

/**
 * URL de arquivo segura: aceita apenas http/https. Bloqueia esquemas perigosos
 * (javascript:, data:, vbscript:) que, se renderizados em href/src no frontend,
 * causariam XSS armazenado. z.string().url() sozinho NÃO basta — o construtor URL
 * aceita "javascript:alert(1)" como válido.
 */
export const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, { message: "URL inválida — apenas http(s) é permitido." });

export const httpUrlOptional = httpUrl.optional();
