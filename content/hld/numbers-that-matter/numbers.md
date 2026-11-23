Use one constant for time: **86,400 seconds in a day** (round it to 100,000 only for mental math, and say so). Use **decimal units**: 1 KB = 1,000 bytes, 1 GB = 10⁹ bytes, 1 TB = 10¹² bytes, which is how disks and cloud storage are sold. If you mean 1,024-based units, write KiB, GiB and TiB.

The chain is short:

1. requests a day = daily users × requests each
2. peak requests a second = requests a day ÷ 86,400 × peak factor
3. writes a day = requests a day × (1 − read share)
4. storage = writes a day × bytes per write × 365 × years kept × copies
5. cache memory = distinct items read in a day × hot fraction × bytes per item

The presets above the figures are the old Capacity Lab examples. Pick one and the whole chapter recomputes.
