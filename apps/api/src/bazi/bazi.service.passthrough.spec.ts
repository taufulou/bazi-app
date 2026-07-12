import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaziService } from './bazi.service';

/**
 * Focused unit tests for the public engine passthrough (mobile free-preview 排盤 +
 * element encyclopedia). Only `configService` (engine URL) + global fetch are
 * exercised, so the other 4 constructor deps are stubbed.
 */
describe('BaziService — engine passthrough', () => {
  const ENGINE_URL = 'http://engine.test:5001';
  let service: BaziService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    const config = { get: (k: string) => (k === 'BAZI_ENGINE_URL' ? ENGINE_URL : undefined) } as unknown as ConfigService;
    service = new BaziService(
      {} as never, // prisma
      {} as never, // redis
      config,
      {} as never, // ai
      {} as never, // credits
    );
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => jest.restoreAllMocks());

  it('forwards the body to POST {engine}/calculate and returns the JSON envelope', async () => {
    const envelope = { status: 'success', data: { fourPillars: {} } };
    fetchMock.mockResolvedValue({ ok: true, json: async () => envelope });

    const body = { birth_date: '1987-09-06', gender: 'male' };
    const result = await service.passthroughCalculate(body);

    expect(result).toEqual(envelope);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${ENGINE_URL}/calculate`);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual(body);
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  it('routes explain-element to POST {engine}/explain-element', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: 1 }) });
    await service.passthroughExplainElement({ elementType: 'stem', value: '戊' });
    expect(fetchMock.mock.calls[0][0]).toBe(`${ENGINE_URL}/explain-element`);
  });

  it('surfaces the engine error detail + status on a non-ok response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, json: async () => ({ detail: 'bad birth_date' }) });
    await expect(service.passthroughCalculate({})).rejects.toMatchObject({
      message: 'bad birth_date',
    });
    await expect(service.passthroughCalculate({})).rejects.toBeInstanceOf(HttpException);
  });

  it('extracts the first msg from a FastAPI 422 detail array', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: [{ loc: ['body', 'birth_date'], msg: 'invalid date', type: 'value_error' }] }),
    });
    await expect(service.passthroughCalculate({})).rejects.toMatchObject({ message: 'invalid date' });
  });

  it('throws a 502 when the engine is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const err = (await service.passthroughCalculate({}).catch((e) => e)) as HttpException;
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(502);
  });
});
