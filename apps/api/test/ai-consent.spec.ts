/**
 * 1B item 3 — storing the user's AI-data consent (App Store guideline 5.1.2(i)).
 */
import { ConflictException, ValidationPipe } from '@nestjs/common';
import { UsersService } from '../src/users/users.service';
import { UpdateUserDto } from '../src/users/dto/update-user.dto';
import { RecordAiConsentDto } from '../src/users/dto/ai-consent.dto';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../src/common/validation-pipe-options';
import { AI_CONSENT_ACCEPTED_VERSIONS, AI_CONSENT_VERSION } from '../src/legal/legal-constants';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  creditLedger: { create: jest.fn() },
};

describe('AI consent (1B item 3)', () => {
  let svc: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new UsersService(mockPrisma as never, { get: jest.fn() } as never, {} as never);
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkUserId: 'clerk_1' });
    mockPrisma.user.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve(data));
    mockPrisma.user.findFirst.mockResolvedValue(null);
  });

  it('records an accepted version with a timestamp', async () => {
    const res = await svc.recordAiConsent('clerk_1', AI_CONSENT_VERSION);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { aiConsentAt: expect.any(Date), aiConsentVersion: AI_CONSENT_VERSION },
      select: { aiConsentAt: true, aiConsentVersion: true },
    });
    expect(res.aiConsentCurrentVersion).toBe(AI_CONSENT_VERSION);
  });

  it('works before any other call created the user row (ensureUser, not a 404)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: 'u-new', clerkUserId: 'clerk_new' });
    await svc.recordAiConsent('clerk_new', AI_CONSENT_VERSION);
    expect(mockPrisma.user.create).toHaveBeenCalled();
    expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u-new' } }));
  });

  it('refuses an unknown version with 409 and the current version — nothing written', async () => {
    const err = await svc.recordAiConsent('clerk_1', 'ai-1999-01-01').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'CONSENT_VERSION_UNKNOWN', currentVersion: AI_CONSENT_VERSION });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('withdrawal nulls both columns', async () => {
    await svc.withdrawAiConsent('clerk_1');
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { aiConsentAt: null, aiConsentVersion: null },
    });
  });

  it('GET /users/me exposes the current and accepted versions alongside the stored ones', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', aiConsentAt: null, aiConsentVersion: null });
    const me = await svc.findByClerkId('clerk_1');
    expect(me).toMatchObject({
      aiConsentAt: null,
      aiConsentVersion: null,
      aiConsentCurrentVersion: AI_CONSENT_VERSION,
      aiConsentAcceptedVersions: AI_CONSENT_ACCEPTED_VERSIONS,
    });
  });

  describe('validation', () => {
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);

    it('PATCH /users/me cannot set the consent fields (whitelist rejects them)', async () => {
      // updateProfile spreads the DTO straight into prisma.user.update, so these
      // must never become DTO fields.
      await expect(
        pipe.transform({ aiConsentAt: new Date().toISOString() }, { type: 'body', metatype: UpdateUserDto }),
      ).rejects.toBeDefined();
      await expect(
        pipe.transform({ aiConsentVersion: AI_CONSENT_VERSION }, { type: 'body', metatype: UpdateUserDto }),
      ).rejects.toBeDefined();
    });

    it.each(['', 'has space', 'x'.repeat(33), 'ai/../x'])('the consent body rejects %p', async (version) => {
      await expect(pipe.transform({ version }, { type: 'body', metatype: RecordAiConsentDto })).rejects.toBeDefined();
    });

    it('the consent body accepts the current version', async () => {
      await expect(
        pipe.transform({ version: AI_CONSENT_VERSION }, { type: 'body', metatype: RecordAiConsentDto }),
      ).resolves.toMatchObject({ version: AI_CONSENT_VERSION });
    });
  });
});
