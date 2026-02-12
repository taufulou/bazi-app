"use client";

import DatePicker, { registerLocale } from "react-datepicker";
import { parse, format, isValid } from "date-fns";
import { zhTW } from "date-fns/locale/zh-TW";
import "react-datepicker/dist/react-datepicker.css";
import "./DateTimePickerTheme.css";

registerLocale("zh-TW", zhTW);

const MIN_DATE = new Date(1920, 0, 1);
const DEFAULT_OPEN_DATE = new Date(1990, 0, 1); // Default calendar view: Jan 1990
const REF_FORMAT = "yyyy-MM-dd";

interface DatePickerInputProps {
  value: string; // "YYYY-MM-DD"
  onChange: (value: string) => void;
  className?: string;
}

export default function DatePickerInput({
  value,
  onChange,
  className,
}: DatePickerInputProps) {
  const selected = value
    ? (() => {
        const d = parse(value, REF_FORMAT, new Date());
        return isValid(d) ? d : null;
      })()
    : null;

  const handleChange = (date: Date | null) => {
    if (!date || !isValid(date)) {
      onChange("");
      return;
    }
    onChange(format(date, REF_FORMAT));
  };

  return (
    <DatePicker
      selected={selected}
      onChange={handleChange}
      dateFormat={REF_FORMAT}
      locale="zh-TW"
      showYearDropdown
      showMonthDropdown
      dropdownMode="select"
      openToDate={selected ?? DEFAULT_OPEN_DATE}
      minDate={MIN_DATE}
      maxDate={new Date()}
      placeholderText="選擇或輸入日期"
      className={className}
      autoComplete="off"
      showPopperArrow={false}
    />
  );
}
