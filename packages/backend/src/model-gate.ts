// The one check every model call passes: a model or provider the user turned off is refused, and a
// call with no model runs the user's default. Task runs, chats, features, tending, memory and the
// loop guard all reach their provider through a runner wrapped here.
import { checkModel, Conflict, type ModelRunner, type UserSettings } from '@factory/core';

export function gatedRunner(base: () => ModelRunner, user: { get(): Promise<UserSettings> }): ModelRunner {
  return {
    async run(request) {
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
): Promise<string | undefined> {
  return checkModel(await user.get(), model).refused;
}
