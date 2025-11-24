import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

// Whitelist of allowed admin emails
const ALLOWED_EMAILS = [
  'gabe@manafoldgames.com',
  'nathan@manafoldgames.com',
];

export const authConfig: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: 'consent',
          access_type: 'offline',
          response_type: 'code',
        },
      },
    }),
  ],
  pages: {
    signIn: '/sign-in',
    error: '/sign-in', // Redirect errors to sign-in page
  },
  callbacks: {
    async signIn({ user }) {
      // Only allow whitelisted email addresses
      if (!user.email || !ALLOWED_EMAILS.includes(user.email)) {
        console.log(`[Auth] Rejected login attempt from: ${user.email}`);
        return false;
      }

      console.log(`[Auth] Approved login for: ${user.email}`);
      return true;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnSignIn = nextUrl.pathname.startsWith('/sign-in');
      const isOnAuth = nextUrl.pathname.startsWith('/api/auth');

      // Allow auth API routes
      if (isOnAuth) return true;

      if (isOnSignIn) {
        if (isLoggedIn) return Response.redirect(new URL('/', nextUrl));
        return true;
      }

      return isLoggedIn;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.email = token.email as string;
      }
      return session;
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  trustHost: true, // Trust the host for reverse proxy setups
};
