import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Mark a route as public (no Clerk authentication required).
 * Use on controllers or individual route handlers.
 *
 * @example
 * @Public()
 * @Get('health')
 * getHealth() { return { status: 'ok' }; }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
