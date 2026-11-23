"""Back-of-the-envelope capacity estimator with worked steps.

Fixed after the Phase 1 numbers audit:
- One constant for time. Every step uses 86,400 seconds a day; the old version
  divided by 100,000 for QPS and multiplied by 86,400 for storage, so storage
  came out 13.6% low.
- Decimal units, labelled as such: 1 GB = 10^9 bytes, 1 TB = 10^12 bytes. The old
  version divided by 1024^3 and printed "GB".
- Cache memory comes from distinct hot items × item size. The old "20% of daily
  reads × payload" counted a popular item once per read.

The same formulas drive chapter 3 ("Numbers that matter"); tests check they agree.
"""

from __future__ import annotations

from typing import Any

SECONDS_PER_DAY = 86_400
GB = 10**9
TB = 10**12


def calculate_capacity(
    dau: int,
    actions_per_user_per_day: float,
    peak_multiplier: float,
    avg_payload_bytes: int,
    retention_years: int,
    read_share_percent: float = 90.0,
    replication_factor: int = 3,
    distinct_items_read_per_day: int | None = None,
    hot_fraction: float = 0.2,
) -> dict[str, Any]:
    """Compute QPS, bandwidth, multi-year storage and hot-cache memory, with the formulas used."""
    daily_actions = dau * actions_per_user_per_day
    avg_qps = daily_actions / SECONDS_PER_DAY
    peak_qps = avg_qps * peak_multiplier

    read_frac = max(0.0, min(100.0, read_share_percent)) / 100.0
    write_frac = 1.0 - read_frac

    read_qps_avg = avg_qps * read_frac
    write_qps_avg = avg_qps * write_frac
    read_qps_peak = peak_qps * read_frac
    write_qps_peak = peak_qps * write_frac

    peak_bytes_per_sec = peak_qps * avg_payload_bytes
    peak_mb_per_sec = peak_bytes_per_sec / 10**6
    peak_mbps = (peak_bytes_per_sec * 8) / 10**6

    daily_write_bytes = daily_actions * write_frac * avg_payload_bytes
    daily_storage_gb = daily_write_bytes / GB
    raw_retention_tb = (daily_write_bytes * 365 * retention_years) / TB
    replicated_retention_tb = raw_retention_tb * replication_factor

    # Distinct items, not requests: each cached item is stored once however often it is read.
    # Without a distinct-item count, assume one distinct item read per active user per day.
    distinct = distinct_items_read_per_day if distinct_items_read_per_day else dau
    hot_cache_gb = distinct * hot_fraction * avg_payload_bytes / GB

    return {
        "units": "decimal (1 GB = 10^9 bytes, 1 TB = 10^12 bytes)",
        "metrics": {
            "dailyActions": round(daily_actions),
            "avgQps": round(avg_qps, 2),
            "peakQps": round(peak_qps, 2),
            "readQpsAvg": round(read_qps_avg, 2),
            "writeQpsAvg": round(write_qps_avg, 2),
            "readQpsPeak": round(read_qps_peak, 2),
            "writeQpsPeak": round(write_qps_peak, 2),
            "peakBandwidthMBps": round(peak_mb_per_sec, 3),
            "peakBandwidthMbps": round(peak_mbps, 2),
            "dailyStorageGB": round(daily_storage_gb, 3),
            "rawRetentionTB": round(raw_retention_tb, 3),
            "replicatedRetentionTB": round(replicated_retention_tb, 3),
            "hotCacheGB": round(hot_cache_gb, 3),
            # Kept for older clients; same value as hotCacheGB, now from distinct items.
            "hotCache2080GB": round(hot_cache_gb, 3),
        },
        "workedSteps": [
            {
                "label": "1. Daily actions",
                "formula": f"{dau:,} DAU × {actions_per_user_per_day:g} actions/day",
                "result": f"{daily_actions:,.0f} actions/day",
            },
            {
                "label": "2. Average and peak QPS",
                "formula": f"{daily_actions:,.0f} ÷ 86,400 s × {peak_multiplier:g} peak",
                "result": f"{avg_qps:,.1f} avg QPS → {peak_qps:,.1f} peak QPS",
            },
            {
                "label": "3. Read / write split",
                "formula": f"{read_share_percent:.0f}% reads / {100 - read_share_percent:.0f}% writes",
                "result": f"Peak {read_qps_peak:,.1f} read QPS | {write_qps_peak:,.1f} write QPS",
            },
            {
                "label": "4. Peak bandwidth",
                "formula": f"{peak_qps:,.1f} peak QPS × {avg_payload_bytes:,} bytes",
                "result": f"{peak_mb_per_sec:,.2f} MB/s ({peak_mbps:,.1f} Mbit/s)",
            },
            {
                "label": "5. Storage over the retention period, all copies",
                "formula": (
                    f"{daily_storage_gb:,.2f} GB/day × 365 × {retention_years} years × {replication_factor} copies"
                ),
                "result": f"{raw_retention_tb:,.2f} TB raw → {replicated_retention_tb:,.2f} TB with copies",
            },
            {
                "label": "6. Hot cache memory",
                "formula": f"{distinct:,} distinct items/day × {hot_fraction:.0%} hot × {avg_payload_bytes:,} bytes",
                "result": f"{hot_cache_gb:,.2f} GB",
            },
        ],
    }
