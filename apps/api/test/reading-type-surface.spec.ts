import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ReadingType } from '@prisma/client';
import { CreateReadingDto, BAZI_CREATABLE_READING_TYPES } from '../src/bazi/dto/create-reading.dto';

/**
 * Which reading types the Bazi endpoint will create.
 *
 * ZWDS was deleted for never shipping, and an audit of that deletion found the
 * door still open from the other side: `@IsEnum(ReadingType)` accepted all 17
 * enum values, `createReading` has no family check beyond an active `Service`
 * row, and all ten ZWDS rows are active. So `POST /api/bazi/readings` with
 * `readingType: 'ZWDS_LIFETIME'` deducted 2 credits and dispatched into the
 * ZWDS prompt map — narrating a 紫微斗數 reading over Bazi-shaped calculation
 * data. Coherent-looking paid output about a chart that was never computed.
 *
 * ⚠️ These run the REAL validator against the REAL DTO. The bug was that the
 * `@ApiProperty` enum list said one thing and the validator did another, so a
 * test asserting against a hand-written list of allowed types would have
 * reproduced exactly that mistake.
 */

async function errorsFor(readingType: string) {
  const dto = plainToInstance(CreateReadingDto, {
    birthProfileId: 'p1',
    readingType,
  });
  return validate(dto);
}

const ZWDS_TYPES = Object.values(ReadingType).filter((t) => t.startsWith('ZWDS_'));

describe('CreateReadingDto — the Bazi endpoint accepts only Bazi types', () => {
  it('rejects every ZWDS type', async () => {
    // Object.values, not a literal list: a ZWDS type added to the schema later
    // is covered without anyone remembering to extend this.
    expect(ZWDS_TYPES.length).toBeGreaterThan(0);
    for (const t of ZWDS_TYPES) {
      const errors = await errorsFor(t);
      expect(errors.map((e) => e.property)).toContain('readingType');
    }
  });

  it('accepts every Bazi type', async () => {
    for (const t of BAZI_CREATABLE_READING_TYPES) {
      expect(await errorsFor(t)).toHaveLength(0);
    }
  });

  it('rejects a value that is not in the enum at all', async () => {
    expect(await errorsFor('NOT_A_TYPE')).not.toHaveLength(0);
  });

  it('rejects the non-Bazi types that are neither ZWDS nor creatable here', async () => {
    // FORTUNE and COMPATIBILITY are real reading types with their own endpoints;
    // this one must not mint them either.
    const others = Object.values(ReadingType).filter(
      (t) =>
        !t.startsWith('ZWDS_') &&
        !(BAZI_CREATABLE_READING_TYPES as readonly string[]).includes(t),
    );
    for (const t of others) {
      expect(await errorsFor(t)).not.toHaveLength(0);
    }
  });

  it('documents in Swagger exactly what it validates', async () => {
    // The original bug was the two disagreeing. Binding the decorator to the
    // same constant makes divergence impossible, and this asserts the binding.
    const allowed = new Set<string>(BAZI_CREATABLE_READING_TYPES);
    for (const t of Object.values(ReadingType)) {
      const rejected = (await errorsFor(t)).length > 0;
      expect(rejected).toBe(!allowed.has(t));
    }
  });
});
