import 'server-only';
import { backendCall } from '@factory/backend/client';
import { z } from 'zod';
import { FeatureActionAvailability, FeatureId, FeatureStage, GrillTurn, Ticket } from '@factory/core';

export const FeatureSummary = z.object({
  id: FeatureId,
  title: z.string(),
  stage: FeatureStage,
  tickets: z.number(),
  error: z.string().optional(),
});
export const FeatureDetail = z.object({
  id: FeatureId,
  title: z.string(),
  stage: FeatureStage,
  grill: z.object({ turns: z.array(GrillTurn) }).default({ turns: [] }),
  spec: z.string().optional(),
  critique: z.string().optional(),
  qa: z.string().optional(),
  tickets: z.array(Ticket),
  error: z.string().optional(),
  working: z.object({ action: z.string() }).optional(),
  /** What the backend accepts now. The page shows a control only for an allowed action. */
  actions: z.array(FeatureActionAvailability).default([]),
});
export type FeatureDetail = z.infer<typeof FeatureDetail>;
export async function listFeatures(project: string) {
  return z.array(FeatureSummary).parse(JSON.parse((await backendCall('ListFeatures', { project })).json));
}
export async function getFeature(project: string, id: string) {
  return FeatureDetail.parse(JSON.parse((await backendCall('GetFeature', { project, id })).json));
}
