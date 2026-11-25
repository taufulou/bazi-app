/**
 * 1B — the privacy policy names Anthropic as the only AI provider. Configuring
 * another provider must be loud at boot (owner decision 2026-11-21).
 */
import { AIProvider } from '@prisma/client';
import { providersMissingFromPrivacyPolicy, PROVIDERS_NAMED_IN_PRIVACY_POLICY } from '../src/ai/ai-provider-disclosure';
import { AIService } from '../src/ai/ai.service';

describe('AI provider disclosure', () => {
  it('Anthropic alone is consistent with the policy', () => {
    expect(providersMissingFromPrivacyPolicy([AIProvider.CLAUDE])).toEqual([]);
  });

  it('GPT or Gemini are flagged as undisclosed', () => {
    expect(providersMissingFromPrivacyPolicy([AIProvider.CLAUDE, AIProvider.GPT, AIProvider.GEMINI])).toEqual([
      AIProvider.GPT,
      AIProvider.GEMINI,
    ]);
  });

  it('the policy names only the providers listed here', () => {
    expect(PROVIDERS_NAMED_IN_PRIVACY_POLICY).toEqual([AIProvider.CLAUDE]);
  });

  describe('AIService.initializeProviders (behavioural)', () => {
    // Built without Nest DI: only the config lookup and the logger matter here,
    // and the real constructor needs collaborators this check never touches.
    function boot(keys: Record<string, string | undefined>) {
      const svc = Object.create(AIService.prototype) as Record<string, unknown>;
      const error = jest.fn();
      svc.configService = { get: (k: string) => keys[k] };
      svc.providers = [];
      svc.logger = { log: jest.fn(), warn: jest.fn(), error };
      (svc as unknown as { initializeProviders(): void }).initializeProviders();
      return error;
    }

    it('logs an ERROR when OPENAI_API_KEY is set', () => {
      const error = boot({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' });
      expect(error).toHaveBeenCalledWith(expect.stringContaining('GPT'));
    });

    it('logs an ERROR when GEMINI_API_KEY is set', () => {
      const error = boot({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' });
      expect(error).toHaveBeenCalledWith(expect.stringContaining('GEMINI'));
    });

    it('stays quiet with Anthropic alone', () => {
      expect(boot({ ANTHROPIC_API_KEY: 'a' })).not.toHaveBeenCalled();
    });
  });
});
