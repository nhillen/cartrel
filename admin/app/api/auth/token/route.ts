/**
 * API route to get the JWT token from the NextAuth session
 * This allows the client to get the token and send it to the backend API
 */

import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Get the JWT token from the session cookie
    const token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET,
    });

    if (!token) {
      return NextResponse.json({ error: 'No session' }, { status: 401 });
    }

    // Return the raw JWT token string
    // getToken() returns the decoded payload, but we need to get the raw token
    // The raw token is stored in the session cookie
    const sessionToken = request.cookies.get('next-auth.session-token') ||
                        request.cookies.get('__Secure-next-auth.session-token');

    if (!sessionToken) {
      return NextResponse.json({ error: 'No session token found' }, { status: 401 });
    }

    return NextResponse.json({ token: sessionToken.value });
  } catch (error) {
    console.error('Error getting session token:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
