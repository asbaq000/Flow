import { ok } from '@/lib/api';
import { pushEnabled, pushPublicKey } from '@/lib/push';

/** The public half of the signing key. The browser needs it to subscribe. */
export async function GET() {
  return ok({ enabled: pushEnabled, key: pushEnabled ? pushPublicKey : null });
}
