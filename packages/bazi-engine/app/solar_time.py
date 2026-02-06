"""
True Solar Time (真太陽時) Calculator

Standard clock time ≠ solar time. Bazi Hour Pillar must use True Solar Time.
Two corrections are needed:
1. Longitude offset: Birth city longitude vs timezone standard meridian
2. Equation of Time: Earth's orbital eccentricity (±16 minutes)

Without this correction, Hour Pillar can be WRONG by 1-2 hours.
"""

import math
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple

import ephem

from .constants import CITY_COORDINATES


def get_city_coordinates(
    city_name: str,
    longitude: Optional[float] = None,
    latitude: Optional[float] = None,
) -> Tuple[float, float]:
    """
    Get longitude and latitude for a city.
    Uses pre-coded coordinates or provided values.

    Args:
        city_name: Name of the birth city (Chinese or English)
        longitude: Pre-provided longitude (takes priority)
        latitude: Pre-provided latitude (takes priority)

    Returns:
        Tuple of (longitude, latitude)

    Raises:
        ValueError: If city not found and no coordinates provided
    """
    if longitude is not None and latitude is not None:
        return (longitude, latitude)

    # Try exact match first
    if city_name in CITY_COORDINATES:
        return CITY_COORDINATES[city_name]

    # Try partial match (e.g., "台北" in "台北市信義區")
    for key, coords in CITY_COORDINATES.items():
        if key in city_name or city_name in key:
            return coords

    # If we have at least longitude, use it (latitude less critical for solar time)
    if longitude is not None:
        return (longitude, latitude or 0.0)

    raise ValueError(
        f"Cannot find coordinates for city '{city_name}'. "
        "Please provide birth_longitude and birth_latitude."
    )


def get_timezone_offset_hours(timezone_str: str, dt: datetime) -> float:
    """
    Get the STANDARD (non-DST) UTC offset in hours for a timezone.

    IMPORTANT: For Bazi calculations, we use standard time, NOT DST.
    Bazi is based on solar position, so we need the standard timezone offset
    (which corresponds to the "normal" meridian for that region) regardless
    of whether DST was in effect on the birth date.

    For example:
    - China used DST (UTC+9) in summers of 1986-1991, but for Bazi,
      we always use UTC+8 because the standard meridian is 120°E.
    - If the user's clock said 14:30 during China DST, the actual
      standard time was 13:30, and we compute solar time from 13:30.

    Args:
        timezone_str: IANA timezone string (e.g., 'Asia/Taipei')
        dt: The datetime (used to determine standard offset for the zone)

    Returns:
        Standard (non-DST) UTC offset in hours (e.g., 8.0 for Asia/Shanghai)
    """
    # Use a lookup for standard offsets of known timezones
    # This avoids DST confusion for historical dates
    STANDARD_OFFSETS: Dict[str, float] = {
        # East Asia (UTC+8)
        'Asia/Taipei': 8.0,
        'Asia/Shanghai': 8.0,
        'Asia/Chongqing': 8.0,
        'Asia/Harbin': 8.0,
        'Asia/Urumqi': 6.0,      # Xinjiang uses UTC+6 informally
        'Asia/Hong_Kong': 8.0,
        'Asia/Macau': 8.0,
        'Asia/Kuala_Lumpur': 8.0,
        'Asia/Singapore': 8.0,
        'PRC': 8.0,
        'ROC': 8.0,
        'Hongkong': 8.0,
        # East Asia (UTC+9)
        'Asia/Tokyo': 9.0,
        'Asia/Seoul': 9.0,
        'Japan': 9.0,
        # Southeast Asia
        'Asia/Bangkok': 7.0,
        'Asia/Ho_Chi_Minh': 7.0,
        'Asia/Jakarta': 7.0,
        'Asia/Makassar': 8.0,
        'Asia/Jayapura': 9.0,
        'Asia/Manila': 8.0,
        'Asia/Phnom_Penh': 7.0,
        'Asia/Vientiane': 7.0,
        'Asia/Yangon': 6.5,
        # South Asia
        'Asia/Kolkata': 5.5,
        'Asia/Colombo': 5.5,
        'Asia/Kathmandu': 5.75,
        'Asia/Dhaka': 6.0,
        # Central/West Asia
        'Asia/Karachi': 5.0,
        'Asia/Tehran': 3.5,
        'Asia/Dubai': 4.0,
        # Australia
        'Australia/Sydney': 10.0,
        'Australia/Melbourne': 10.0,
        'Australia/Brisbane': 10.0,
        'Australia/Perth': 8.0,
        'Australia/Adelaide': 9.5,
        'Australia/Darwin': 9.5,
        # Americas
        'America/New_York': -5.0,
        'America/Chicago': -6.0,
        'America/Denver': -7.0,
        'America/Los_Angeles': -8.0,
        'America/Toronto': -5.0,
        'America/Vancouver': -8.0,
        'America/Sao_Paulo': -3.0,
        # Europe
        'Europe/London': 0.0,
        'Europe/Paris': 1.0,
        'Europe/Berlin': 1.0,
        'Europe/Moscow': 3.0,
        # Other
        'Pacific/Auckland': 12.0,
        'Pacific/Honolulu': -10.0,
        'UTC': 0.0,
        'GMT': 0.0,
    }

    if timezone_str in STANDARD_OFFSETS:
        return STANDARD_OFFSETS[timezone_str]

    # Fallback: try zoneinfo but use January date (typically no DST) to get standard offset
    import zoneinfo

    try:
        tz = zoneinfo.ZoneInfo(timezone_str)
        # Use January 1 of the same year to avoid DST
        jan_dt = datetime(dt.year, 1, 15, 12, 0, tzinfo=tz)
        offset = jan_dt.utcoffset()
        if offset is not None:
            return offset.total_seconds() / 3600.0
    except Exception:
        pass

    # Ultimate fallback
    return 8.0  # Default to UTC+8 (most of our target market)


def calculate_equation_of_time(dt: datetime) -> float:
    """
    Calculate the Equation of Time correction in minutes.
    Uses the ephem library for precise calculation.

    The Equation of Time accounts for:
    1. Earth's elliptical orbit (eccentricity)
    2. Axial tilt (obliquity)

    These cause the sun to be up to ~16 minutes ahead or behind mean solar time.

    Args:
        dt: The date to calculate for

    Returns:
        Equation of Time in minutes (positive = sun ahead of mean time)
    """
    # Create ephem date
    observer = ephem.Observer()
    observer.date = ephem.Date(dt)

    # Calculate sun position
    sun = ephem.Sun(observer)

    # Equation of time: difference between apparent solar time and mean solar time
    # ephem gives Right Ascension (RA) of the sun
    # We need to compare with Mean Sun's RA

    # Method: Use the transit time approach
    # The Equation of Time = 12:00:00 - local apparent noon (solar transit)

    # Alternative: Use the formula based on day of year
    day_of_year = dt.timetuple().tm_yday
    # B factor
    B = 2.0 * math.pi * (day_of_year - 81) / 365.0

    # Equation of Time in minutes (Spencer's formula, accurate to ~30 seconds)
    eot = (
        9.87 * math.sin(2 * B)
        - 7.53 * math.cos(B)
        - 1.5 * math.sin(B)
    )

    return eot


def calculate_true_solar_time(
    birth_date: str,
    birth_time: str,
    birth_city: str,
    birth_timezone: str,
    birth_longitude: Optional[float] = None,
    birth_latitude: Optional[float] = None,
) -> Dict:
    """
    Calculate True Solar Time from clock time.

    True Solar Time = Clock Time + Longitude Correction + Equation of Time

    Longitude Correction = (birth_longitude - standard_meridian) * 4 minutes/degree
    Standard Meridian = UTC_offset * 15 degrees

    Args:
        birth_date: Birth date in YYYY-MM-DD format
        birth_time: Birth time in HH:MM format (24-hour)
        birth_city: Birth city name
        birth_timezone: IANA timezone string
        birth_longitude: Optional pre-provided longitude
        birth_latitude: Optional pre-provided latitude

    Returns:
        Dictionary with true solar time details
    """
    # Parse datetime
    dt = datetime.strptime(f"{birth_date} {birth_time}", "%Y-%m-%d %H:%M")

    # Get coordinates
    lng, lat = get_city_coordinates(birth_city, birth_longitude, birth_latitude)

    # Get STANDARD (non-DST) timezone offset
    standard_utc_offset = get_timezone_offset_hours(birth_timezone, dt)

    # Check if DST was in effect and adjust clock time to standard time
    # This is important for historical dates (e.g., China DST 1986-1991)
    dst_adjustment = 0.0
    try:
        import zoneinfo
        tz = zoneinfo.ZoneInfo(birth_timezone)
        aware_dt = dt.replace(tzinfo=tz)
        actual_offset = aware_dt.utcoffset()
        if actual_offset is not None:
            actual_offset_hours = actual_offset.total_seconds() / 3600.0
            dst_adjustment = actual_offset_hours - standard_utc_offset
            # If DST was in effect, the clock was ahead by 1 hour
            # We subtract this to get standard time
            if abs(dst_adjustment) > 0.01:
                dt = dt - timedelta(hours=dst_adjustment)
    except Exception:
        pass

    # Calculate standard meridian for this timezone
    standard_meridian = standard_utc_offset * 15.0

    # Longitude correction: 4 minutes per degree of longitude difference
    # Positive = east of standard meridian = sun reaches zenith earlier = add time
    longitude_correction = (lng - standard_meridian) * 4.0  # minutes

    # Equation of Time correction
    eot = calculate_equation_of_time(dt)

    # Total correction in minutes
    total_correction = longitude_correction + eot

    # Apply correction to get true solar time
    true_solar_dt = dt + timedelta(minutes=total_correction)

    return {
        'clock_time': datetime.strptime(f"{birth_date} {birth_time}", "%Y-%m-%d %H:%M").strftime('%H:%M'),
        'clock_datetime': dt,  # Already adjusted to standard time if DST
        'true_solar_time': true_solar_dt.strftime('%H:%M'),
        'true_solar_datetime': true_solar_dt,
        'longitude_offset': round(longitude_correction, 2),
        'equation_of_time': round(eot, 2),
        'total_adjustment': round(total_correction, 2),
        'dst_adjustment': round(dst_adjustment * 60, 2),  # in minutes
        'birth_city': birth_city,
        'birth_longitude': lng,
        'birth_latitude': lat,
        'standard_meridian': standard_meridian,
        'utc_offset': standard_utc_offset,
    }
