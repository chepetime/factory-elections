import { z } from 'zod';

/** A dated change whose savings can later be compared for the affected task classes. */
export const Experiment = z.object({
  id: z.uuid(),
  date: z.iso.date(),
  change: z.string().trim().min(1).max(2000),
  task_classes: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
});
export type Experiment = z.infer<typeof Experiment>;
export const NewExperiment = Experiment.omit({ id: true });
