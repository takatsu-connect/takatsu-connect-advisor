import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "@/lib/env";

const env = getEnv();

export const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});
