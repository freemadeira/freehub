/** Why a run didn't happen: there's no key, the person ran too many lately, or the model failed. */
export type AiFailure = "off" | "limit" | "failed";

export class AiError extends Error {
  override name = "AiError";
  readonly reason: AiFailure;

  constructor(reason: AiFailure, message: string = reason) {
    super(message);
    this.reason = reason;
  }
}
