/**
 * Asks a model on OpenRouter for an answer in a given shape, through its
 * chat completions API with strict structured output. Each person may start
 * so many runs an hour, counted across what they save and sort.
 */
import { errorMessage } from "@/lib/utils";

import { AiError } from "./ai-error";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT = 60_000;
const HOUR = 60 * 60 * 1000;

/** A JSON schema, as strict structured output takes it: every field required, nothing else allowed. */
export type JsonSchema = Record<string, unknown>;

export interface AiConfig {
  apiKey?: string;
  model: string;
  runsPerHour: number;
  /** The organization's name, which OpenRouter shows its runs under. */
  appName: string;
}

interface Completion {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { message?: string };
}

export class Ai {
  private readonly config: AiConfig;
  /** When each person's recent runs started, in milliseconds. */
  private readonly runs = new Map<string, number[]>();
  /** What runs cost since the reader started, in USD, as OpenRouter said. */
  private spent = 0;

  constructor(config: AiConfig) {
    this.config = config;
  }

  get enabled(): boolean {
    return Boolean(this.config.apiKey);
  }

  /** Takes one of the person's runs for this hour, if they have one left. */
  private take(person: string): boolean {
    const now = Date.now();
    const recent = (this.runs.get(person) ?? []).filter(
      (at) => now - at < HOUR
    );
    if (recent.length >= this.config.runsPerHour) {
      this.runs.set(person, recent);
      return false;
    }
    this.runs.set(person, [...recent, now]);
    return true;
  }

  /** Whether the person could start a run now. */
  canRun(person: string): boolean {
    const now = Date.now();
    const recent = (this.runs.get(person) ?? []).filter(
      (at) => now - at < HOUR
    );
    return this.enabled && recent.length < this.config.runsPerHour;
  }

  /**
   * What the model makes of `prompt`, as JSON in the shape of `schema`, for
   * `person`. Throws an AiError when it can't run or doesn't answer in shape.
   */
  async run(
    person: string,
    {
      name,
      instructions,
      prompt,
      schema,
    }: {
      name: string;
      instructions: string;
      prompt: string;
      schema: JsonSchema;
    }
  ): Promise<unknown> {
    const { apiKey, model, appName } = this.config;
    if (!apiKey) {
      throw new AiError("off", "There's no OpenRouter key.");
    }
    if (!this.take(person)) {
      throw new AiError("limit", "Too many runs lately.");
    }
    let answer: Completion;
    try {
      const response = await fetch(ENDPOINT, {
        body: JSON.stringify({
          messages: [
            { content: instructions, role: "system" },
            { content: prompt, role: "user" },
          ],
          model,
          // Only providers that keep to the schema, rather than taking it as a hint.
          provider: { require_parameters: true },
          response_format: {
            json_schema: { name, schema, strict: true },
            type: "json_schema",
          },
          temperature: 0,
          usage: { include: true },
        }),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Title": appName,
        },
        method: "POST",
        signal: AbortSignal.timeout(TIMEOUT),
      });
      answer = (await response.json()) as Completion;
      if (!response.ok) {
        throw new Error(answer.error?.message ?? `HTTP ${response.status}`);
      }
    } catch (error) {
      throw new AiError("failed", errorMessage(error));
    }
    this.spent += answer.usage?.cost ?? 0;
    const content = answer.choices?.[0]?.message?.content;
    try {
      return JSON.parse(content ?? "");
    } catch {
      throw new AiError("failed", "The model didn't answer in shape.");
    }
  }

  /** What runs cost since the reader started, in USD. */
  get cost(): number {
    return this.spent;
  }
}

/** A field of the model's answer that has to be a string. */
export function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** A field of the model's answer that has to be a list of strings. */
export function texts(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** A field of the model's answer that has to be a list of numbers. */
export function numbers(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is number =>
          typeof item === "number" && Number.isFinite(item)
      )
    : [];
}

/** The model's answer as an object of fields, or nothing when it isn't one. */
export function fields(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...value }
    : undefined;
}
