"""Deterministic Back-of-the-Envelope Capacity Estimator with worked step-by-step math."""

from __future__ import annotations

from typing import Any


def calculate_capacity(
    dau: int,
    actions_per_user_per_day: float,
    peak_multiplier: float,
    avg_payload_bytes: int,
    retention_years: int,
    read_share_percent: float = 90.0,
    replication_factor: int = 3,
) -> dict[str, Any]:
    """Compute QPS, bandwidth, multi-year storage, and 80/20 hot cache RAM with formulas."""
    daily_actions = dau * actions_per_user_per_day
    avg_qps = daily_actions / 100_000.0
    peak_qps = avg_qps * peak_multiplier

    read_frac = max(0.0, min(100.0, read_share_percent)) / 100.0
    write_frac = 1.0 - read_frac

    read_qps_avg = avg_qps * read_frac
    write_qps_avg = avg_qps * write_frac
    read_qps_peak = peak_qps * read_frac
    write_qps_peak = peak_qps * write_frac

    peak_bytes_per_sec = peak_qps * avg_payload_bytes
    peak_mb_per_sec = peak_bytes_per_sec / (1024 * 1024)
    peak_mbps = (peak_bytes_per_sec * 8) / 1_000_000.0

    daily_write_bytes = write_qps_avg * 86_400 * avg_payload_bytes
    daily_storage_gb = daily_write_bytes / (1024**3)
    raw_retention_tb = (daily_write_bytes * 365 * retention_years) / (1024**4)
    replicated_retention_tb = raw_retention_tb * replication_factor

    # 80/20 rule over daily read working set (capped conservatively if read-heavy)
    daily_read_bytes = read_qps_avg * 86_400 * avg_payload_bytes
    hot_cache_gb = (daily_read_bytes * 0.20) / (1024**3)

    return {
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
            "hotCache2080GB": round(hot_cache_gb, 3),
        },
        "workedSteps": [
            {
                "label": "1. Daily Actions",
                "formula": f"{dau:,} DAU × {actions_per_user_per_day} actions/day",
                "result": f"{daily_actions:,.0f} actions/day",
            },
            {
                "label": "2. Average & Peak QPS (10^5s rule)",
                "formula": f"{daily_actions:,.0f} ÷ 100,000 × {peak_multiplier}x peak",
                "result": f"{avg_qps:,.1f} avg QPS → {peak_qps:,.1f} peak QPS",
            },
            {
                "label": "3. Read / Write Split",
                "formula": f"{read_share_percent:.0f}% reads / {100 - read_share_percent:.0f}% writes",
                "result": f"Peak {read_qps_peak:,.1f} read QPS | {write_qps_peak:,.1f} write QPS",
            },
            {
                "label": "4. Peak Network Bandwidth",
                "formula": f"{peak_qps:,.1f} peak QPS × {avg_payload_bytes:,} bytes",
                "result": f"{peak_mb_per_sec:,.2f} MB/s ({peak_mbps:,.1f} Mbps)",
            },
            {
                "label": "5. Multi-Year Storage (with Replication)",
                "formula": f"{daily_storage_gb:,.2f} GB/day × 365 × {retention_years}y × {replication_factor}x replicas",
                "result": f"{raw_retention_tb:,.2f} TB raw → {replicated_retention_tb:,.2f} TB replicated",
            },
            {
                "label": "6. 80/20 Hot Cache RAM",
                "formula": "20% of daily read working set × avg payload",
                "result": f"{hot_cache_gb:,.2f} GB RAM estimate",
            },
        ],
    }
