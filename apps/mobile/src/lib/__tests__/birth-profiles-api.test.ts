import {
  genderToApi,
  genderFromApi,
  profileToFormValues,
  formValuesToPayload,
  type BirthProfile,
} from '../birth-profiles-api';
import type { BirthDataFormValues } from '../birth-profile-types';

const rogerProfile: BirthProfile = {
  id: 'p1',
  name: 'Roger',
  birthDate: '1987-09-06T00:00:00.000Z',
  birthTime: '16:11',
  hourKnown: true,
  birthCity: '吉打',
  birthTimezone: 'Asia/Kuala_Lumpur',
  birthLongitude: null,
  birthLatitude: null,
  gender: 'MALE',
  relationshipTag: 'SELF',
  isPrimary: true,
  isLunarDate: false,
  lunarBirthDate: null,
  isLeapMonth: false,
  createdAt: '',
  updatedAt: '',
};

describe('birth-profiles-api mappers', () => {
  it('maps gender both directions', () => {
    expect(genderToApi('male')).toBe('MALE');
    expect(genderToApi('female')).toBe('FEMALE');
    expect(genderFromApi('MALE')).toBe('male');
    expect(genderFromApi('FEMALE')).toBe('female');
  });

  it('profileToFormValues strips the ISO time + normalizes fields', () => {
    const fv = profileToFormValues(rogerProfile);
    expect(fv).toEqual({
      name: 'Roger',
      gender: 'male',
      birthDate: '1987-09-06',
      birthTime: '16:11',
      hourKnown: true,
      birthCity: '吉打',
      birthTimezone: 'Asia/Kuala_Lumpur',
      isLunarDate: false,
      isLeapMonth: false,
    });
  });

  it('profileToFormValues maps a 時辰未知 profile to blank time + hourKnown false', () => {
    const fv = profileToFormValues({ ...rogerProfile, birthTime: null, hourKnown: false });
    expect(fv.birthTime).toBe('');
    expect(fv.hourKnown).toBe(false);
  });

  it('formValuesToPayload round-trips a solar known-hour profile', () => {
    const fv: BirthDataFormValues = {
      name: 'Roger',
      gender: 'male',
      birthDate: '1987-09-06',
      birthTime: '16:11',
      hourKnown: true,
      birthCity: '吉打',
      birthTimezone: 'Asia/Kuala_Lumpur',
      isLunarDate: false,
      isLeapMonth: false,
    };
    const payload = formValuesToPayload(fv, 'SELF');
    expect(payload).toMatchObject({
      name: 'Roger',
      birthDate: '1987-09-06',
      birthTime: '16:11',
      hourKnown: true,
      gender: 'MALE',
      relationshipTag: 'SELF',
      isLunarDate: false,
    });
    expect(payload.lunarBirthDate).toBeUndefined();
  });

  it('formValuesToPayload omits birthTime for 時辰未知', () => {
    const fv: BirthDataFormValues = {
      name: 'Roger',
      gender: 'male',
      birthDate: '1987-09-06',
      birthTime: '16:11',
      hourKnown: false,
      birthCity: '吉打',
      birthTimezone: 'Asia/Kuala_Lumpur',
      isLunarDate: false,
      isLeapMonth: false,
    };
    const payload = formValuesToPayload(fv, 'SELF');
    expect(payload.hourKnown).toBe(false);
    expect(payload.birthTime).toBeUndefined();
  });

  it('formValuesToPayload passes lunarBirthDate only when isLunarDate', () => {
    const fv: BirthDataFormValues = {
      name: 'Laopo',
      gender: 'female',
      birthDate: '1987-01-25',
      birthTime: '12:00',
      hourKnown: true,
      birthCity: '台北',
      birthTimezone: 'Asia/Taipei',
      isLunarDate: true,
      isLeapMonth: false,
    };
    const payload = formValuesToPayload(fv, 'FAMILY', '1986-12-26');
    expect(payload.isLunarDate).toBe(true);
    expect(payload.lunarBirthDate).toBe('1986-12-26');
    expect(payload.gender).toBe('FEMALE');
    expect(payload.relationshipTag).toBe('FAMILY');
  });

  it('formValuesToPayload defaults relationshipTag to SELF', () => {
    const fv: BirthDataFormValues = {
      name: 'X',
      gender: 'male',
      birthDate: '2000-01-01',
      birthTime: '00:00',
      hourKnown: true,
      birthCity: '台北',
      birthTimezone: 'Asia/Taipei',
      isLunarDate: false,
      isLeapMonth: false,
    };
    expect(formValuesToPayload(fv).relationshipTag).toBe('SELF');
  });
});
