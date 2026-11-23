import type { Finding } from "./types";

/** Stable identity of a finding: one recommendation per rule per entity (or per account). */
export const fingerprintOf = (f: Pick<Finding, "ruleId" | "entityId">) => `${f.ruleId}:${f.entityId ?? "account"}`;
