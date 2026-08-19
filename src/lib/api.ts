import { NextResponse } from 'next/server';
import { AuthError, currentUser } from './auth';
import type { User } from './types';

export const ok = <T,>(data: T, status = 200) => NextResponse.json(data as object, { status });
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

/** Wraps a handler so auth failures and thrown errors become clean JSON. */
export function withUser<C>(
  handler: (user: User, ctx: C) => Promise<NextResponse> | NextResponse
) {
  return async (_req: Request, ctx: C): Promise<NextResponse> => {
    try {
      const user = await currentUser();
      if (!user) return fail('Not signed in', 401);
      return await handler(user, ctx);
    } catch (err) {
      if (err instanceof AuthError) return fail(err.message, err.status);
      console.error('[api]', err);
      return fail(err instanceof Error ? err.message : 'Server error', 500);
    }
  };
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
