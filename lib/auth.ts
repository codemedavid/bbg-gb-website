import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { env } from './env';
import { decideJwtSecretOutcome } from './jwt-config';

export type JwtPayload = { sub: string; role: 'customer' | 'admin'; email: string };

/**
 * The HS256 key, refusing to hand back one the public already has.
 *
 * scripts/check-config.ts blocks a production deploy that has no real
 * JWT_SECRET, so in the normal course this never fires. It exists for the case
 * where that gate was bypassed: signing with the repository's own fallback
 * would issue tokens anyone can forge, silently and successfully, and a
 * security control that fails open is not one. Refusing is the louder failure
 * and the recoverable one — setting the variable fixes it.
 *
 * Keyed on isProductionDeploy rather than isProd so a local `next start` used
 * for QA keeps working, exactly like the deploy gate it mirrors.
 */
const secret = () => {
  if (env.isProductionDeploy) {
    const outcome = decideJwtSecretOutcome({ secret: env.rawJwtSecret, isProductionDeploy: true });
    if (outcome.blocksBuild) throw new Error(outcome.message);
  }
  return new TextEncoder().encode(env.jwtSecret);
};

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}
export async function signToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret());
}
export async function verifyToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, secret());
  return payload as unknown as JwtPayload;
}

export const COOKIE_NAME = 'bbg_token';
export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.isProd,
  maxAge: 7 * 24 * 60 * 60,
  path: '/',
};
