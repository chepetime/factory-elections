// The one check every model call passes: while the emergency stop is on every call is refused, a
// model or provider the user turned off is refused, and a call with no model runs the user's
// default. Task runs, chats, features, tending, memory and the loop guard all reach their provider
// through a runner wrapped here.
import { checkModel, Conflict, type ModelRunner, type UserSettings } from '@factory/core';

/** Why nothing may run now (the emergency stop), or undefined. */
export type Halt = { refusal(): string | undefined };
const running: Halt = { refusal: () => undefined };

export function gatedRunner(
  base: () => ModelRunner,
  user: { get(): Promise<UserSettings> },
  halt: Halt = running,
): ModelRunner {
  return {
    async run(request) {
      const halted = halt.refusal();
      if (halted) throw new Conflict(halted);
      const { model, refused } = checkModel(await user.get(), request.model);
      if (refused) throw new Conflict(refused);
      return base().run({ ...request, model });
    },
  };
}

/** Why a review on this provider may not start, or undefined. `model` is what the review runs. */
export async function reviewRefusal(
  user: { get(): Promise<UserSettings> },
  model: string,
  halt: Halt = running,
): Promise<string | undefined> {
  return halt.refusal() ?? checkModel(await user.get(), model).refused;
}
