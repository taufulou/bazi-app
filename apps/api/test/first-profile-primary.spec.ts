/**
 * Bug 2 — a user's first birth profile must become primary.
 *
 * Found by walking the real first-run path in production: enter your birth
 * data, open 運勢, and be told 「找不到出生資料」 one screen later. Fortune
 * resolves the profile by `isPrimary`, and the create form never surfaces that
 * flag, so `dto.isPrimary` is undefined and the old `|| false` left every new
 * account with no primary profile at all.
 */
import { UsersService } from '../src/users/users.service';

function buildService(existingProfileCount: number) {
  const created: Array<Record<string, unknown>> = [];
  const prisma = {
    birthProfile: {
      count: jest.fn().mockResolvedValue(existingProfileCount),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return Promise.resolve({ id: 'p1', ...args.data });
      }),
    },
  };
  const svc = new UsersService(
    prisma as never,
    { get: () => undefined } as never,
    {} as never, // aiService — unused on this path
  );
  // `ensureUser` is private and hits Clerk/DB. The flag under test does not
  // depend on it, so it is replaced rather than mocked through the public API.
  (svc as unknown as { ensureUser: () => Promise<{ id: string }> }).ensureUser =
    () => Promise.resolve({ id: 'u1' });
  return { svc, created, prisma };
}

const dto = {
  name: 'Roger',
  birthDate: '1987-09-06',
  birthTime: '16:11',
  birthCity: '吉打',
  birthTimezone: 'Asia/Kuala_Lumpur',
  gender: 'MALE',
} as never;

describe('first birth profile', () => {
  it('becomes primary when the account has none', async () => {
    const { svc, created } = buildService(0);
    await svc.createBirthProfile('clerk_1', dto);
    expect(created[0]!.isPrimary).toBe(true);
  });

  it('does NOT hijack primary when one already exists', async () => {
    const { svc, created, prisma } = buildService(1);
    await svc.createBirthProfile('clerk_1', dto);
    expect(created[0]!.isPrimary).toBe(false);
    // and it must not have demoted the existing primary
    expect(prisma.birthProfile.updateMany).not.toHaveBeenCalled();
  });

  it('still honours an explicit isPrimary on a later profile', async () => {
    const { svc, created, prisma } = buildService(3);
    await svc.createBirthProfile('clerk_1', { ...(dto as object), isPrimary: true } as never);
    expect(created[0]!.isPrimary).toBe(true);
    // explicit primary demotes the previous one; auto-primary has nothing to demote
    expect(prisma.birthProfile.updateMany).toHaveBeenCalled();
  });
});
