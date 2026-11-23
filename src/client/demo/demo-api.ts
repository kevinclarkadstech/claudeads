/**
 * In-browser implementation of the app API for the public demo. It runs the same mock
 * provider, rules engine and mock AI analyst as the server, so visitors see real output
 * with no backend, no account and no cost. Per-visitor state lives in localStorage.
 */
import { ACCOUNTS, buildTree, generateMetrics } from "../../worker/providers/mock";
import type { Platform, ProviderDailyMetric, ProviderEntity } from "../../worker/providers/types";
import { contextFromProviderData } from "../../worker/rules/context";
import { evaluate } from "../../worker/rules/rules";
import { fingerprintOf } from "../../worker/rules/fingerprint";
import type { Finding, RuleContext } from "../../worker/rules/types";
import { buildAccountSummary } from "../../worker/ai/summary";
import { mockReview } from "../../worker/ai/mock";
import { addDays, todayInTimezone } from "../../worker/lib/dates";
import {
  ApiError,
  type AdAccount,
  type AiReview,
  type Connection,
  type Level,
  type MetricsResponse,
  type Recommendation,
  type RecStatus,
  type SyncRun,
  type Totals,
} from "../lib/api";
import type { Api } from "../lib/api-context";

const STORAGE_KEY = "astuteads-demo-v1";
const SYNC_MS = 2200;
const AI_MS = 2600;
const HISTORY_DAYS = 90;

interface DemoState {
  firstVisit: number;
  selected: Record<string, boolean>;
  syncStartedAt: Record<string, { at: number; trigger: SyncRun["trigger"] }>;
  recStatus: Record<string, { status: RecStatus; at: number }>;
  aiRunAt: Record<string, number>;
}

const DEMO_ACCOUNTS: { id: string; platform: Platform; externalId: string; selectedByDefault: boolean }[] = [
  { id: "meta-us", platform: "meta", externalId: "act_1000000001", selectedByDefault: true },
  { id: "meta-eu", platform: "meta", externalId: "act_1000000002", selectedByDefault: true },
  { id: "google-search", platform: "google", externalId: "1234567890", selectedByDefault: true },
  { id: "google-shopping", platform: "google", externalId: "1234567891", selectedByDefault: false },
];

function loadState(): DemoState {
  const fresh: DemoState = { firstVisit: Date.now(), selected: {}, syncStartedAt: {}, recStatus: {}, aiRunAt: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...fresh, ...(JSON.parse(raw) as Partial<DemoState>) };
  } catch {
    /* storage unavailable (private mode etc.): run with in-memory state */
  }
  return fresh;
}

export function resetDemo() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

interface AccountData {
  def: (typeof DEMO_ACCOUNTS)[number];
  info: { name: string; currency: string; timezone: string };
  entities: ProviderEntity[];
  byExternal: Map<string, ProviderEntity>;
  rows: ProviderDailyMetric[];
  today: string;
  ctx: RuleContext;
  findings: Finding[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const zero = (): Totals => ({ impressions: 0, clicks: 0, spendMicros: 0, conversions: 0, conversionValueMicros: 0, reach: null });

function add(t: Totals, r: ProviderDailyMetric) {
  t.impressions += r.impressions;
  t.clicks += r.clicks;
  t.spendMicros += r.spendMicros;
  t.conversions = Math.round((t.conversions + r.conversions) * 10) / 10;
  t.conversionValueMicros += r.conversionValueMicros;
  if (r.reach != null) t.reach = (t.reach ?? 0) + r.reach;
}

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const;

export function createDemoApi(): Api {
  const state = loadState();
  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  };
  const cache = new Map<string, AccountData>();

  function data(id: string): AccountData {
    const hit = cache.get(id);
    if (hit) return hit;
    const def = DEMO_ACCOUNTS.find((a) => a.id === id);
    if (!def) throw new ApiError(404, { error: "not_found", message: "Account not found." });
    const meta = ACCOUNTS[def.platform].find((a) => a.externalId === def.externalId)!;
    const info = { name: meta.name, currency: meta.currency, timezone: meta.timezone };
    const today = todayInTimezone(info.timezone);
    const { entities } = buildTree(def.platform, def.externalId);
    const rows = generateMetrics(def.platform, def.externalId, { start: addDays(today, -(HISTORY_DAYS - 1)), end: today });
    const ctx = contextFromProviderData({ account: { id, platform: def.platform, currency: info.currency }, today, entities, rows });
    const d: AccountData = { def, info, entities, byExternal: new Map(entities.map((e) => [e.externalId, e])), rows, today, ctx, findings: evaluate(ctx) };
    cache.set(id, d);
    return d;
  }

  const isSelected = (id: string) => state.selected[id] ?? DEMO_ACCOUNTS.find((a) => a.id === id)!.selectedByDefault;

  /** Pre-selected accounts look like they were synced shortly before the first visit. */
  function syncOf(id: string): { at: number; trigger: SyncRun["trigger"] } | null {
    if (state.syncStartedAt[id]) return state.syncStartedAt[id]!;
    const def = DEMO_ACCOUNTS.find((a) => a.id === id)!;
    return def.selectedByDefault ? { at: state.firstVisit - 6 * 60_000, trigger: "scheduled" } : null;
  }

  function latestSync(id: string): SyncRun | null {
    const s = syncOf(id);
    if (!s) return null;
    const running = Date.now() < s.at + SYNC_MS;
    const d = data(id);
    return {
      id: `${id}-sync-${s.at}`,
      status: running ? "running" : "succeeded",
      trigger: s.trigger,
      rangeStart: addDays(d.today, s.trigger === "initial" ? -59 : -6),
      rangeEnd: d.today,
      rowsUpserted: running ? 0 : d.rows.length,
      error: null,
      createdAt: new Date(s.at).toISOString(),
      startedAt: new Date(s.at).toISOString(),
      finishedAt: running ? null : new Date(s.at + SYNC_MS).toISOString(),
    };
  }

  function account(id: string): AdAccount {
    const d = data(id);
    const sync = latestSync(id);
    return {
      id,
      connectionId: `conn-${d.def.platform}`,
      platform: d.def.platform,
      externalId: d.def.externalId,
      name: d.info.name,
      currency: d.info.currency,
      timezone: d.info.timezone,
      isSelected: isSelected(id),
      lastSyncedAt: sync?.status === "succeeded" ? sync.finishedAt : null,
      latestSync: sync,
    };
  }

  const hasData = (id: string) => isSelected(id) && account(id).lastSyncedAt !== null;

  function recsFor(id: string): Recommendation[] {
    const d = data(id);
    const out: Recommendation[] = [];
    const base = {
      adAccountId: id,
      accountName: d.info.name,
      platform: d.def.platform,
      currency: d.info.currency,
      createdAt: new Date(state.firstVisit).toISOString(),
    };
    const statusOf = (recId: string) => state.recStatus[recId];
    const entityInfo = (entityId: string | null) => {
      const e = entityId ? d.byExternal.get(entityId) : undefined;
      return { entityName: e?.name ?? null, entityLevel: e?.level ?? null };
    };

    for (const f of d.findings) {
      const recId = `${id}|${fingerprintOf(f)}`;
      const st = statusOf(recId);
      out.push({
        ...base,
        id: recId,
        entityId: f.entityId,
        ...entityInfo(f.entityId),
        source: "rule",
        ruleId: f.ruleId,
        severity: f.severity,
        title: f.title,
        body: f.body,
        evidence: f.evidence,
        estimatedImpact: f.estimatedImpact as Recommendation["estimatedImpact"],
        status: st?.status ?? "open",
        updatedAt: new Date(st?.at ?? syncOf(id)?.at ?? state.firstVisit).toISOString(),
      });
    }

    const aiAt = state.aiRunAt[id];
    if (aiAt && Date.now() >= aiAt + AI_MS) {
      const { summary, refs } = buildAccountSummary(d.ctx, d.findings, d.info);
      mockReview(summary).recommendations.forEach((r, i) => {
        const recId = `${id}|ai|${r.category}|${r.entityRef ?? "account"}`;
        const entityId = r.entityRef ? refs.get(r.entityRef) ?? null : null;
        const st = statusOf(recId);
        out.push({
          ...base,
          id: recId,
          entityId,
          ...entityInfo(entityId),
          source: "ai",
          ruleId: `ai:${r.category}`,
          severity: r.severity,
          title: r.title,
          body: r.body,
          evidence: { category: r.category, confidence: r.confidence, relatedRules: r.relatedRules, rank: i + 1 },
          estimatedImpact: { note: r.expectedImpact },
          status: st?.status ?? "open",
          updatedAt: new Date(st?.at ?? aiAt + AI_MS).toISOString(),
        });
      });
    }
    return out;
  }

  const api: Api = {
    isDemo: true,

    async connections() {
      await sleep(120);
      const connections: Connection[] = (["meta", "google"] as const).map((platform) => ({
        id: `conn-${platform}`,
        platform,
        externalUserId: `demo_${platform}_user`,
        status: "active",
        isMock: true,
        scopes: platform === "meta" ? ["ads_read"] : ["https://www.googleapis.com/auth/adwords"],
        createdAt: new Date(state.firstVisit).toISOString(),
        adAccounts: DEMO_ACCOUNTS.filter((a) => a.platform === platform)
          .map((a) => account(a.id))
          .sort((x, y) => x.name.localeCompare(y.name)),
      }));
      return { mockMode: true, connections };
    },

    async disconnect() {
      throw new ApiError(400, { error: "demo", message: "Connections can't be removed in the demo." });
    },

    async setAccountSelected(id, selected) {
      await sleep(80);
      const wasEverSynced = account(id).lastSyncedAt !== null || state.syncStartedAt[id];
      state.selected[id] = selected;
      let syncStarted = false;
      if (selected && !wasEverSynced) {
        state.syncStartedAt[id] = { at: Date.now(), trigger: "initial" };
        syncStarted = true;
      }
      save();
      return { adAccount: account(id), syncStarted };
    },

    startConnect() {
      /* Already connected in the demo. */
    },

    async adAccount(id) {
      await sleep(60);
      return { adAccount: { ...account(id), nextManualSyncAt: null } };
    },

    async syncNow(id) {
      await sleep(80);
      if (account(id).latestSync?.status === "running") throw new ApiError(409, { error: "in_progress", message: "A sync is already running." });
      state.syncStartedAt[id] = { at: Date.now(), trigger: "manual" };
      save();
      return { syncRunId: `${id}-sync-${state.syncStartedAt[id]!.at}` };
    },

    async metrics(id, days, level: Level): Promise<MetricsResponse> {
      await sleep(150);
      const d = data(id);
      const to = d.today;
      const from = addDays(to, -(days - 1));
      const prevFrom = addDays(from, -days);
      const prevTo = addDays(from, -1);

      const daily = new Map<string, Totals>();
      for (let x = from; x <= to; x = addDays(x, 1)) daily.set(x, zero());
      const current = zero();
      const previous = zero();
      const perEntity = new Map<string, Totals>();
      for (const r of d.rows) {
        if (r.level === "campaign") {
          if (r.date >= from && r.date <= to) {
            add(daily.get(r.date)!, r);
            add(current, r);
          } else if (r.date >= prevFrom && r.date <= prevTo) add(previous, r);
        }
        if (r.level === level && r.date >= from && r.date <= to) {
          let t = perEntity.get(r.externalId);
          if (!t) perEntity.set(r.externalId, (t = zero()));
          add(t, r);
        }
      }

      const entities = d.entities
        .filter((e) => e.level === level)
        .map((e) => ({
          id: e.externalId,
          name: e.name,
          status: e.status,
          parentId: e.parentExternalId,
          parentName: e.parentExternalId ? d.byExternal.get(e.parentExternalId)?.name ?? null : null,
          dailyBudgetMicros: e.dailyBudgetMicros ?? null,
          ...(perEntity.get(e.externalId) ?? zero()),
        }))
        .sort((a, b) => b.spendMicros - a.spendMicros);

      return {
        range: { from, to, days, previousFrom: prevFrom, previousTo: prevTo },
        currency: d.info.currency,
        level,
        totals: { current, previous },
        daily: [...daily.entries()].map(([date, t]) => ({ date, ...t })),
        entities,
      };
    },

    async recommendations(status, adAccountId) {
      await sleep(120);
      const ids = adAccountId ? [adAccountId] : DEMO_ACCOUNTS.map((a) => a.id);
      const all = ids.filter(hasData).flatMap(recsFor);
      const counts: Record<RecStatus, number> = { open: 0, accepted: 0, dismissed: 0, resolved: 0 };
      for (const r of all) counts[r.status]++;
      const recommendations = all
        .filter((r) => r.status === status)
        .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.updatedAt.localeCompare(a.updatedAt));
      return { recommendations, counts };
    },

    async setRecommendationStatus(id, status) {
      await sleep(60);
      state.recStatus[id] = { status, at: Date.now() };
      save();
      return { recommendation: { id, status } };
    },

    async aiReview(id) {
      await sleep(80);
      const at = state.aiRunAt[id];
      if (!at) return { review: null, provider: "mock", nextAvailableAt: null };
      const done = Date.now() >= at + AI_MS;
      let summary: string | null = null;
      if (done) {
        const d = data(id);
        summary = mockReview(buildAccountSummary(d.ctx, d.findings, d.info).summary).summary;
      }
      const review: AiReview = {
        id: `${id}-ai-${at}`,
        status: done ? "succeeded" : "running",
        provider: "mock",
        model: done ? "demo-analyst" : null,
        summary,
        error: null,
        createdAt: new Date(at).toISOString(),
        finishedAt: done ? new Date(at + AI_MS).toISOString() : null,
      };
      return { review, provider: "mock", nextAvailableAt: null };
    },

    async runAiReview(id) {
      await sleep(80);
      const at = state.aiRunAt[id];
      if (at && Date.now() < at + AI_MS) throw new ApiError(409, { error: "in_progress", message: "An AI review is already running." });
      state.aiRunAt[id] = Date.now();
      save();
      return { aiReviewId: `${id}-ai-${state.aiRunAt[id]}` };
    },
  };
  return api;
}
