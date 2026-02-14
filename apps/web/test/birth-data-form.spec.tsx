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
      // Date and time labels
      expect(screen.getByText('出生日期')).toBeInTheDocument();
      expect(screen.getByText('出生時間')).toBeInTheDocument();
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
      // Fill in all fields
      fireEvent.change(screen.getByPlaceholderText('請輸入稱呼'), {
        target: { value: '王小明' },
      });
      // Date input
      const dateInputs = document.querySelectorAll('input[type="date"]');
      fireEvent.change(dateInputs[0]!, { target: { value: '1990-05-15' } });
      // Time input
      const timeInputs = document.querySelectorAll('input[type="time"]');
      fireEvent.change(timeInputs[0]!, { target: { value: '14:30' } });

      const submitBtn = screen.getByRole('button', { name: '開始排盤' });
      expect(submitBtn).not.toBeDisabled();
    });
  });

  describe('Form Submission', () => {
    it('should call onSubmit with form values', () => {
      const onSubmit = jest.fn();
      render(<BirthDataForm onSubmit={onSubmit} />);

      // Fill fields
      fireEvent.change(screen.getByPlaceholderText('請輸入稱呼'), {
        target: { value: '王小明' },
      });
      const dateInputs = document.querySelectorAll('input[type="date"]');
      fireEvent.change(dateInputs[0]!, { target: { value: '1990-05-15' } });
      const timeInputs = document.querySelectorAll('input[type="time"]');
      fireEvent.change(timeInputs[0]!, { target: { value: '14:30' } });

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
      const dateInputs = document.querySelectorAll('input[type="date"]');
      fireEvent.change(dateInputs[0]!, { target: { value: '1990-01-01' } });
      const timeInputs = document.querySelectorAll('input[type="time"]');
      fireEvent.change(timeInputs[0]!, { target: { value: '12:00' } });

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
      expect(taiwanCityCount).toBeGreaterThanOrEqual(5); // 11 Taiwan cities

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
      const dateInputs = document.querySelectorAll('input[type="date"]');
      fireEvent.change(dateInputs[0]!, { target: { value: '1990-01-01' } });
      const timeInputs = document.querySelectorAll('input[type="time"]');
      fireEvent.change(timeInputs[0]!, { target: { value: '12:00' } });

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
