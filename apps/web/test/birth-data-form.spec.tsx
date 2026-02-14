/**
 * Tests for BirthDataForm component.
 * Validates form rendering, field interactions, validation, and submission.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import BirthDataForm, {
  type BirthDataFormValues,
} from '../app/components/BirthDataForm';

// ============================================================
// Helpers
// ============================================================

const defaultProps = {
  onSubmit: jest.fn(),
};

function renderForm(overrides: Partial<typeof defaultProps> = {}) {
  return render(<BirthDataForm {...defaultProps} {...overrides} />);
}

/** Fill year/month/day/hour/minute dropdowns by aria-label */
function fillDate(year: string, month: string, day: string) {
  fireEvent.change(screen.getByLabelText('年'), { target: { value: year } });
  fireEvent.change(screen.getByLabelText('月'), { target: { value: month } });
  fireEvent.change(screen.getByLabelText('日'), { target: { value: day } });
}

function fillTime(hour: string, minute: string, period: 'AM' | 'PM' = 'AM') {
  fireEvent.change(screen.getByLabelText('時'), { target: { value: hour } });
  fireEvent.change(screen.getByLabelText('分'), { target: { value: minute } });
  fireEvent.change(screen.getByLabelText('午別'), { target: { value: period } });
}

function fillAllRequired(name = '王小明') {
  fireEvent.change(screen.getByPlaceholderText('請輸入稱呼'), {
    target: { value: name },
  });
  fillDate('1990', '05', '15');
  fillTime('2', '30', 'PM'); // 2:30 PM = 14:30 in 24h
}

// ============================================================
// Tests
// ============================================================

describe('BirthDataForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the default title and subtitle', () => {
      renderForm();
      expect(screen.getByText('輸入出生資料')).toBeInTheDocument();
      expect(
        screen.getByText('請填寫準確的出生時間以獲得最精確的分析'),
      ).toBeInTheDocument();
    });

    it('should render custom title and subtitle', () => {
      renderForm();
      const { unmount } = render(
        <BirthDataForm
          onSubmit={jest.fn()}
          title="自定標題"
          subtitle="自定描述"
        />,
      );
      expect(screen.getByText('自定標題')).toBeInTheDocument();
      expect(screen.getByText('自定描述')).toBeInTheDocument();
      unmount();
    });

    it('should render all form fields', () => {
      renderForm();
      // Name field
      expect(screen.getByPlaceholderText('請輸入稱呼')).toBeInTheDocument();
      // Gender buttons
      expect(screen.getByText('♂ 男')).toBeInTheDocument();
      expect(screen.getByText('♀ 女')).toBeInTheDocument();
      // Date dropdowns (year/month/day)
      expect(screen.getByText('出生日期')).toBeInTheDocument();
      expect(screen.getByLabelText('年')).toBeInTheDocument();
      expect(screen.getByLabelText('月')).toBeInTheDocument();
      expect(screen.getByLabelText('日')).toBeInTheDocument();
      // Time dropdowns (hour/minute/AM-PM)
      expect(screen.getByText('出生時間')).toBeInTheDocument();
      expect(screen.getByLabelText('時')).toBeInTheDocument();
      expect(screen.getByLabelText('分')).toBeInTheDocument();
      expect(screen.getByLabelText('午別')).toBeInTheDocument();
      // Region, city and timezone
      expect(screen.getByText('地區')).toBeInTheDocument();
      expect(screen.getByText('出生地')).toBeInTheDocument();
      expect(screen.getByText('時區')).toBeInTheDocument();
    });

    it('should render submit button with default label', () => {
      renderForm();
      expect(
        screen.getByRole('button', { name: '開始排盤' }),
      ).toBeInTheDocument();
    });

    it('should render custom submit label', () => {
      render(
        <BirthDataForm onSubmit={jest.fn()} submitLabel="立即分析" />,
      );
      expect(
        screen.getByRole('button', { name: '立即分析' }),
      ).toBeInTheDocument();
    });
  });

  describe('Gender Selection', () => {
    it('should default to male', () => {
      renderForm();
      const maleBtn = screen.getByText('♂ 男');
      const femaleBtn = screen.getByText('♀ 女');
      // Male should have active class (the button should have a different class)
      expect(maleBtn.className).not.toBe(femaleBtn.className);
    });

    it('should toggle gender on click', () => {
      renderForm();
      const femaleBtn = screen.getByText('♀ 女');
      fireEvent.click(femaleBtn);
      // After clicking female, female button should have active class
      const maleBtn = screen.getByText('♂ 男');
      expect(femaleBtn.className).not.toBe(maleBtn.className);
    });
  });

  describe('Form Validation', () => {
    it('should disable submit when name is empty', () => {
      renderForm();
      const submitBtn = screen.getByRole('button', { name: '開始排盤' });
      expect(submitBtn).toBeDisabled();
    });

    it('should disable submit when date is empty', () => {
      renderForm();
      const nameInput = screen.getByPlaceholderText('請輸入稱呼');
      fireEvent.change(nameInput, { target: { value: '測試' } });
      const submitBtn = screen.getByRole('button', { name: '開始排盤' });
      expect(submitBtn).toBeDisabled();
    });

    it('should enable submit when all required fields are filled', () => {
      renderForm();
      fillAllRequired();
      const submitBtn = screen.getByRole('button', { name: '開始排盤' });
      expect(submitBtn).not.toBeDisabled();
    });
  });

  describe('Form Submission', () => {
    it('should call onSubmit with form values', () => {
      const onSubmit = jest.fn();
      render(<BirthDataForm onSubmit={onSubmit} />);

      fillAllRequired('王小明');

      // Submit
      const submitBtn = screen.getByRole('button', { name: '開始排盤' });
      fireEvent.click(submitBtn);

      expect(onSubmit).toHaveBeenCalledTimes(1);
      const submittedData = onSubmit.mock.calls[0][0] as BirthDataFormValues;
      expect(submittedData.name).toBe('王小明');
      expect(submittedData.birthDate).toBe('1990-05-15');
      expect(submittedData.birthTime).toBe('14:30');
      expect(submittedData.gender).toBe('male');
      expect(submittedData.birthCity).toBe('台北市');
      expect(submittedData.birthTimezone).toBe('Asia/Taipei');
    });

    it('should not submit when disabled', () => {
      const onSubmit = jest.fn();
      render(<BirthDataForm onSubmit={onSubmit} />);
      // Don't fill fields, try to submit
      const submitBtn = screen.getByRole('button', { name: '開始排盤' });
      fireEvent.click(submitBtn);
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe('Loading State', () => {
    it('should show loading text when isLoading', () => {
      render(<BirthDataForm onSubmit={jest.fn()} isLoading={true} />);
      expect(
        screen.getByRole('button', { name: '排盤中...' }),
      ).toBeInTheDocument();
    });

    it('should disable button when loading', () => {
      render(<BirthDataForm onSubmit={jest.fn()} isLoading={true} />);
      expect(
        screen.getByRole('button', { name: '排盤中...' }),
      ).toBeDisabled();
    });
  });

  describe('Error Display', () => {
    it('should display error message when error prop is provided', () => {
      render(
        <BirthDataForm onSubmit={jest.fn()} error="伺服器錯誤" />,
      );
      expect(screen.getByText('伺服器錯誤')).toBeInTheDocument();
    });

    it('should not display error when error is undefined', () => {
      renderForm();
      const errorElements = document.querySelectorAll('[class*="error"]');
      // Should not have any visible error elements
      expect(errorElements.length).toBe(0);
    });
  });

  describe('Timezone Select', () => {
    it('should have Taiwan as default timezone', () => {
      renderForm();
      const select = screen.getByDisplayValue('台灣 (UTC+8)');
      expect(select).toBeInTheDocument();
    });

    it('should list multiple timezone options', () => {
      renderForm();
      const options = document.querySelectorAll('select option');
      expect(options.length).toBeGreaterThanOrEqual(5);
    });

    it('should group timezones by region using optgroup', () => {
      renderForm();
      const optgroups = document.querySelectorAll('select optgroup');
      expect(optgroups.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Date/Time Dropdowns', () => {
    it('should render year options from current year back to 1920', () => {
      renderForm();
      const yearSelect = screen.getByLabelText('年') as HTMLSelectElement;
      const options = Array.from(yearSelect.querySelectorAll('option'));
      // First option is placeholder "年", then years descending
      expect(options[0].textContent).toBe('年');
      const currentYear = new Date().getFullYear();
      expect(options[1].value).toBe(String(currentYear));
      expect(options[options.length - 1].value).toBe('1920');
    });

    it('should render 12 month options', () => {
      renderForm();
      const monthSelect = screen.getByLabelText('月') as HTMLSelectElement;
      const options = monthSelect.querySelectorAll('option');
      // 1 placeholder + 12 months
      expect(options.length).toBe(13);
    });

    it('should show 31 days for January', () => {
      renderForm();
      fillDate('2000', '01', '');
      const daySelect = screen.getByLabelText('日') as HTMLSelectElement;
      const options = daySelect.querySelectorAll('option');
      // 1 placeholder + 31 days
      expect(options.length).toBe(32);
    });

    it('should show 29 days for February in a leap year', () => {
      renderForm();
      fillDate('2000', '02', '');
      const daySelect = screen.getByLabelText('日') as HTMLSelectElement;
      const options = daySelect.querySelectorAll('option');
      // 1 placeholder + 29 days (2000 is a leap year)
      expect(options.length).toBe(30);
    });

    it('should show 28 days for February in a non-leap year', () => {
      renderForm();
      fillDate('2001', '02', '');
      const daySelect = screen.getByLabelText('日') as HTMLSelectElement;
      const options = daySelect.querySelectorAll('option');
      // 1 placeholder + 28 days
      expect(options.length).toBe(29);
    });

    it('should clamp day when switching to shorter month', () => {
      const onSubmit = jest.fn();
      render(<BirthDataForm onSubmit={onSubmit} />);

      // Pick Jan 31
      fillDate('2000', '01', '31');
      // Switch to February (max 29 days in 2000)
      fireEvent.change(screen.getByLabelText('月'), { target: { value: '02' } });

      // Fill time and name, submit
      fillTime('12', '00', 'PM');
      fireEvent.change(screen.getByPlaceholderText('請輸入稱呼'), {
        target: { value: '測試' },
      });
      fireEvent.click(screen.getByRole('button', { name: '開始排盤' }));

      const data = onSubmit.mock.calls[0][0] as BirthDataFormValues;
      // Day should be clamped to 29 (Feb in leap year 2000)
      expect(data.birthDate).toBe('2000-02-29');
    });

    it('should convert AM time to 24-hour format on submit', () => {
      const onSubmit = jest.fn();
      render(<BirthDataForm onSubmit={onSubmit} />);

      fireEvent.change(screen.getByPlaceholderText('請輸入稱呼'), {
        target: { value: '測試' },
      });
      fillDate('1990', '01', '01');
      fillTime('9', '15', 'AM'); // 9:15 AM = 09:15

      fireEvent.click(screen.getByRole('button', { name: '開始排盤' }));

      const data = onSubmit.mock.calls[0][0] as BirthDataFormValues;
      expect(data.birthTime).toBe('09:15');
    });

    it('should convert PM time to 24-hour format on submit', () => {
      const onSubmit = jest.fn();
      render(<BirthDataForm onSubmit={onSubmit} />);

      fireEvent.change(screen.getByPlaceholderText('請輸入稱呼'), {
        target: { value: '測試' },
      });
      fillDate('1990', '01', '01');
      fillTime('3', '45', 'PM'); // 3:45 PM = 15:45

      fireEvent.click(screen.getByRole('button', { name: '開始排盤' }));

      const data = onSubmit.mock.calls[0][0] as BirthDataFormValues;
      expect(data.birthTime).toBe('15:45');
    });

    it('should handle 12 AM (midnight) correctly', () => {
      const onSubmit = jest.fn();
      render(<BirthDataForm onSubmit={onSubmit} />);

      fireEvent.change(screen.getByPlaceholderText('請輸入稱呼'), {
        target: { value: '測試' },
      });
      fillDate('1990', '01', '01');
      fillTime('12', '00', 'AM'); // 12:00 AM = 00:00

      fireEvent.click(screen.getByRole('button', { name: '開始排盤' }));

      const data = onSubmit.mock.calls[0][0] as BirthDataFormValues;
      expect(data.birthTime).toBe('00:00');
    });

    it('should handle 12 PM (noon) correctly', () => {
      const onSubmit = jest.fn();
      render(<BirthDataForm onSubmit={onSubmit} />);

      fireEvent.change(screen.getByPlaceholderText('請輸入稱呼'), {
        target: { value: '測試' },
      });
      fillDate('1990', '01', '01');
      fillTime('12', '00', 'PM'); // 12:00 PM = 12:00

      fireEvent.click(screen.getByRole('button', { name: '開始排盤' }));

      const data = onSubmit.mock.calls[0][0] as BirthDataFormValues;
      expect(data.birthTime).toBe('12:00');
    });

    it('should render 12 hour options, 60 minute options, and AM/PM selector', () => {
      renderForm();
      const hourSelect = screen.getByLabelText('時') as HTMLSelectElement;
      const minuteSelect = screen.getByLabelText('分') as HTMLSelectElement;
      const periodSelect = screen.getByLabelText('午別') as HTMLSelectElement;
      // 1 placeholder + 12 hours (1-12), 1 placeholder + 60 minutes, 2 options (上午/下午)
      expect(hourSelect.querySelectorAll('option').length).toBe(13);
      expect(minuteSelect.querySelectorAll('option').length).toBe(61);
      expect(periodSelect.querySelectorAll('option').length).toBe(2);
      // Verify AM/PM labels
      const periodOptions = Array.from(periodSelect.querySelectorAll('option'));
      expect(periodOptions[0].textContent).toBe('上午');
      expect(periodOptions[1].textContent).toBe('下午');
    });
  });

  describe('Region-City Cascade', () => {
    function getSelectByLabel(label: string): HTMLSelectElement {
      const labelEl = screen.getByText(label);
      const fieldGroup = labelEl.closest('div');
      return fieldGroup!.querySelector('select') as HTMLSelectElement;
    }

    it('should auto-set timezone when selecting a city in a different region', () => {
      const onSubmit = jest.fn();
      render(<BirthDataForm onSubmit={onSubmit} />);

      // Change region to Japan/Korea
      const regionSelect = getSelectByLabel('地區');
      fireEvent.change(regionSelect, { target: { value: 'japan_korea' } });

      // Select Tokyo
      const citySelect = getSelectByLabel('出生地');
      fireEvent.change(citySelect, { target: { value: '東京' } });

      // Fill other required fields and submit
      fireEvent.change(screen.getByPlaceholderText('請輸入稱呼'), {
        target: { value: '測試' },
      });
      fillDate('1990', '01', '01');
      fillTime('12', '00', 'PM');

      fireEvent.click(screen.getByRole('button', { name: '開始排盤' }));

      const data = onSubmit.mock.calls[0][0] as BirthDataFormValues;
      expect(data.birthCity).toBe('東京');
      expect(data.birthTimezone).toBe('Asia/Tokyo');
    });

    it('should filter cities by selected region', () => {
      renderForm();
      const regionSelect = getSelectByLabel('地區');
      const citySelect = getSelectByLabel('出生地');

      // Default region is Taiwan — should show Taiwan cities
      const taiwanOptions = citySelect.querySelectorAll('option');
      const taiwanCityCount = taiwanOptions.length;
      expect(taiwanCityCount).toBeGreaterThanOrEqual(5); // 22 Taiwan cities

      // Switch to Hong Kong & Macau
      fireEvent.change(regionSelect, { target: { value: 'hong_kong_macau' } });
      const hkOptions = citySelect.querySelectorAll('option');
      expect(hkOptions.length).toBe(3); // 香港, 九龍, 澳門
    });

    it('should auto-select first city when region changes', () => {
      const onSubmit = jest.fn();
      render(<BirthDataForm onSubmit={onSubmit} />);

      // Change region to Malaysia
      const regionSelect = getSelectByLabel('地區');
      fireEvent.change(regionSelect, { target: { value: 'malaysia' } });

      // Fill required fields and submit
      fireEvent.change(screen.getByPlaceholderText('請輸入稱呼'), {
        target: { value: '測試' },
      });
      fillDate('1990', '01', '01');
      fillTime('12', '00', 'PM');

      fireEvent.click(screen.getByRole('button', { name: '開始排盤' }));

      const data = onSubmit.mock.calls[0][0] as BirthDataFormValues;
      expect(data.birthCity).toBe('吉隆坡'); // First Malaysia city
      expect(data.birthTimezone).toBe('Asia/Kuala_Lumpur');
    });

    it('should update city options when region changes', () => {
      renderForm();
      const regionSelect = getSelectByLabel('地區');
      const citySelect = getSelectByLabel('出生地');

      // Switch to Americas
      fireEvent.change(regionSelect, { target: { value: 'americas' } });
      const americasOptions = Array.from(citySelect.querySelectorAll('option')).map(o => o.textContent);
      expect(americasOptions).toContain('紐約');
      expect(americasOptions).toContain('洛杉磯');
      expect(americasOptions).not.toContain('台北市');
    });
  });
});
