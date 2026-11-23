Storage follows the write path only. Each write stores one item; multiply by bytes per item, by 365 days, by the years you keep data, and by the number of copies (a primary and two replicas is three).

Notice what doesn't move: retention and replicas change the disks, not a single request rate on the figure. When an interviewer asks "what if we keep data for ten years?", the answer is about storage and cost, not servers.
