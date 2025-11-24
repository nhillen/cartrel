export { auth as middleware } from '@/lib/auth';

export const config = {
  matcher: ['/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|sign-in).*)'],
};
