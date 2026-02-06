import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthPayload {
  userId: string; // Clerk user ID
  sessionId: string;
}

/**
 * Extract the authenticated user from the request.
 * Use after ClerkAuthGuard has verified the JWT.
 *
 * @example
 * @Get('profile')
 * getProfile(@CurrentUser() user: AuthPayload) {
 *   return this.userService.findByClerkId(user.userId);
 * }
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthPayload | undefined, ctx: ExecutionContext): AuthPayload | string => {
    const request = ctx.switchToHttp().getRequest();
    const auth = request.auth as AuthPayload;

    if (data) {
      return auth[data];
    }

    return auth;
  },
);
