import NextAuth from 'next-auth';
import { authConfig } from './auth.config';

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);

/**
 * Get current authenticated user from session
 * Returns null if not authenticated
 */
export async function getCurrentUser() {
  const session = await auth();
  return session?.user ?? null;
}

/**
 * Require authentication - throws if not authenticated
 * Use in server components and API routes
 */
export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Authentication required');
  }
  return user;
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated() {
  const user = await getCurrentUser();
  return !!user;
}
