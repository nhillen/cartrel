/**
 * API route to generate a JWT token from the NextAuth session
 * This allows the client to get a token to send to the backend API
 */

import { auth } from '@/lib/auth';
import { SignJWT } from 'jose';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Get the current session
    const session = await auth();

    if (!session || !session.user) {
      return NextResponse.json({ error: 'No session' }, { status: 401 });
    }

    // Generate a JWT token for the backend
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);

    const token = await new SignJWT({
      email: session.user.email,
      id: session.user.id,
      sub: session.user.id,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(secret);

    return NextResponse.json({ token });
  } catch (error) {
    console.error('Error generating token:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
