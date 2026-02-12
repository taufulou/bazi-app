"use client";

import styles from "./TimePickerInput.module.css";

// 12-hour display labels: 1, 2, ... 12 (value is 0-11 internal index)
const HOUR_12 = Array.from({ length: 12 }, (_, i) => {
  const idx = (i + 1) % 12; // 1→1, 2→2, ... 11→11, 12→0
  const display = i + 1;     // 1, 2, ... 12
  return { value: String(idx), label: String(display) };
});

const MINUTES = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, "0"),
);

interface TimePickerInputProps {
  value: string; // "HH:mm" (24-hour, stored internally)
  onChange: (value: string) => void;
  className?: string;
}

/** Convert 24-hour hour (0-23) to 12-hour components */
function to12(hour24: number): { hour12: number; period: "AM" | "PM" } {
  const period: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12; // 0-11 (0 = 12 o'clock)
  return { hour12, period };
}

/** Convert 12-hour components back to 24-hour string "HH" */
function to24(hour12: number, period: "AM" | "PM"): string {
  let h24: number;
  if (period === "AM") {
    h24 = hour12 === 0 ? 0 : hour12; // 12AM=0, 1AM=1, ...11AM=11
  } else {
    h24 = hour12 === 0 ? 12 : hour12 + 12; // 12PM=12, 1PM=13, ...11PM=23
  }
  return String(h24).padStart(2, "0");
}

export default function TimePickerInput({
  value,
  onChange,
}: TimePickerInputProps) {
  // Parse stored "HH:mm" → 12-hour components
  const parts = value ? value.split(":") : ["", ""];
  const rawH = parts[0] ?? "";
  const minute = parts[1] ?? "";

  let curHour12 = ""; // "0"-"11" for select value
  let curPeriod: "AM" | "PM" = "AM";

  if (rawH !== "") {
    const h24 = parseInt(rawH, 10);
    if (!isNaN(h24) && h24 >= 0 && h24 <= 23) {
      const converted = to12(h24);
      curHour12 = String(converted.hour12);
      curPeriod = converted.period;
    }
  }

  const emit = (h12: string, m: string, p: "AM" | "PM") => {
    if (h12 === "" || m === "") {
      onChange("");
      return;
    }
    const h24 = to24(parseInt(h12, 10), p);
    onChange(`${h24}:${m}`);
  };

  const handleHourChange = (h12: string) => {
    const m = minute || "00";
    emit(h12, m, curPeriod);
  };

  const handleMinuteChange = (m: string) => {
    const h12 = curHour12 !== "" ? curHour12 : "0";
    emit(h12, m, curPeriod);
  };

  const handlePeriodChange = (p: "AM" | "PM") => {
    if (curHour12 === "") return; // no hour selected yet
    const m = minute || "00";
    emit(curHour12, m, p);
  };

  return (
    <div className={styles.wrapper}>
      <select
        className={styles.select}
        value={curHour12}
        onChange={(e) => handleHourChange(e.target.value)}
        aria-label="小時"
      >
        <option value="" disabled>
          時
        </option>
        {HOUR_12.map((h) => (
          <option key={h.value} value={h.value}>
            {h.label}
          </option>
        ))}
      </select>
      <span className={styles.separator}>:</span>
      <select
        className={styles.select}
        value={minute}
        onChange={(e) => handleMinuteChange(e.target.value)}
        aria-label="分鐘"
      >
        <option value="" disabled>
          分
        </option>
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <select
        className={styles.periodSelect}
        value={curPeriod}
        onChange={(e) => handlePeriodChange(e.target.value as "AM" | "PM")}
        aria-label="上午/下午"
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
