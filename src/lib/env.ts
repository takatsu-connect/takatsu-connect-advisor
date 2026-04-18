import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  // Supabase (server-side)
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1),

  // Claude models
  CLASSIFIER_MODEL: z.string().default("claude-haiku-4-5"),
  SPECIALIST_MODEL: z.string().default("claude-haiku-4-5"),
  ORCHESTRATOR_MODEL: z.string().default("claude-sonnet-4-6"),

  // Chat context / timeouts
  CONTEXT_MESSAGE_LIMIT: z.coerce.number().int().positive().default(20),
  SPECIALIST_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  LOCAL_CACHE_TTL_SECS: z.coerce.number().int().positive().default(30),

  // Google Analytics / Search Console
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1),
  GA_PROPERTY_ID: z.string().min(1),
  GSC_SITE_URL: z.string().min(1),

  // WordPress
  WORDPRESS_API_BASE: z.string().url().default("https://takatsu-connect.com/wp-json"),

  // Runtime mode
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
});

type ServerEnv = z.infer<typeof serverEnvSchema>;
type PublicEnv = z.infer<typeof publicEnvSchema>;
export type Env = ServerEnv & PublicEnv;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsedServer = serverEnvSchema.safeParse(process.env);
  const parsedPublic = publicEnvSchema.safeParse(process.env);

  if (!parsedServer.success || !parsedPublic.success) {
    const issues = [
      ...(parsedServer.success ? [] : parsedServer.error.issues),
      ...(parsedPublic.success ? [] : parsedPublic.error.issues),
    ];
    const message = issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${message}`);
  }

  cached = { ...parsedServer.data, ...parsedPublic.data };
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}
