import 'server-only';
import { backendCall } from '@factory/backend-client';
import { MetricsSummarySchema } from '@factory/core';
// The response shape is core's: the backend builds it, so it is not copied here.
const Metrics = MetricsSummarySchema;

export async function getWeekly(project: string) {
  return Metrics.parse(JSON.parse((await backendCall('GetMetrics', { project, json: '{}' })).json));
}
