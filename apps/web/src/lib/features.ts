import 'server-only';
import { backendCall } from '@factory/backend/client';
import { z } from 'zod';
import { FeatureId, Ticket } from '@factory/core';

export const FeatureSummary = z.object({
  id: FeatureId,
  title: z.string(),
  stage: z.string(),
  tickets: z.number(),
  error: z.string().optional(),
});
export const FeatureDetail = z.object({
  id: FeatureId,
  title: z.string(),
  stage: z.string(),
  spec: z.string().optional(),
  critique: z.string().optional(),
  tickets: z.array(Ticket),
  error: z.string().optional(),
  working: z.object({ action: z.string() }).optional(),
});
export async function listFeatures(project: string) {
  return z.array(FeatureSummary).parse(JSON.parse((await backendCall('ListFeatures', { project })).json));
}
export async function getFeature(project: string, id: string) {
  return FeatureDetail.parse(JSON.parse((await backendCall('GetFeature', { project, id })).json));
}
