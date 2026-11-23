import { relations } from "drizzle-orm";
import { adAccount, adConnection, adEntity, aiReview, dailyMetric, recommendation, syncRun } from "./app";

export const adConnectionRelations = relations(adConnection, ({ many }) => ({
  adAccounts: many(adAccount),
}));

export const adAccountRelations = relations(adAccount, ({ one, many }) => ({
  connection: one(adConnection, { fields: [adAccount.connectionId], references: [adConnection.id] }),
  entities: many(adEntity),
  syncRuns: many(syncRun),
  recommendations: many(recommendation),
}));

export const adEntityRelations = relations(adEntity, ({ one, many }) => ({
  adAccount: one(adAccount, { fields: [adEntity.adAccountId], references: [adAccount.id] }),
  parent: one(adEntity, { fields: [adEntity.parentId], references: [adEntity.id], relationName: "children" }),
  children: many(adEntity, { relationName: "children" }),
  metrics: many(dailyMetric),
}));

export const dailyMetricRelations = relations(dailyMetric, ({ one }) => ({
  entity: one(adEntity, { fields: [dailyMetric.entityId], references: [adEntity.id] }),
}));

export const syncRunRelations = relations(syncRun, ({ one }) => ({
  adAccount: one(adAccount, { fields: [syncRun.adAccountId], references: [adAccount.id] }),
}));

export const recommendationRelations = relations(recommendation, ({ one }) => ({
  adAccount: one(adAccount, { fields: [recommendation.adAccountId], references: [adAccount.id] }),
  entity: one(adEntity, { fields: [recommendation.entityId], references: [adEntity.id] }),
  aiReview: one(aiReview, { fields: [recommendation.aiReviewId], references: [aiReview.id] }),
}));

export const aiReviewRelations = relations(aiReview, ({ one, many }) => ({
  adAccount: one(adAccount, { fields: [aiReview.adAccountId], references: [adAccount.id] }),
  recommendations: many(recommendation),
}));
