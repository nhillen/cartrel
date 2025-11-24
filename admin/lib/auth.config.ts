import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';

// Admin users (in production, move to database)
const ADMIN_USERS = [
  {
    id: '1',
    email: 'admin@cartrel.com',
    name: 'Admin',
    // Password: 'cartrel2025' - hashed with bcrypt
    passwordHash: '$2b$10$WbCyh9WvLMrrBfAvaNOZY.lWnadBGSBRkBoF7g79viPH8nF/5dN16',
  },
];

export const authConfig: NextAuthConfig = {
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = ADMIN_USERS.find(
          (u) => u.email === credentials.email
        );

        if (!user) {
          return null;
        }

        const isValid = await compare(
          credentials.password as string,
          user.passwordHash
        );

        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],
  pages: {
    signIn: '/sign-in',
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnSignIn = nextUrl.pathname.startsWith('/sign-in');
      
      if (isOnSignIn) {
        if (isLoggedIn) return Response.redirect(new URL('/', nextUrl));
        return true;
      }
      
      return isLoggedIn;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
};
