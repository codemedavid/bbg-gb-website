import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { env } from './env';

export type JwtPayload = { sub: string; role: 'customer' | 'admin'; email: string };

const secret = () => new TextEncoder().encode(env.jwtSecret);

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
